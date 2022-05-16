#!/usr/bin/env node
/* jshint esversion: 6 */
const fs = require("fs");
const path = require("path");
const yml = require("js-yaml");
const _ = require("underscore");
const {spawnSync, execSync} = require('child_process');

const DEFAULT_IN = 'cluster-compose.yml';

var noSwarmP = false;
var forcedBranch = undefined;
var prepareHostP = false;

function gitFetch(url, extraArgs) {
    extraArgs = extraArgs || "";
    const project = path.basename(url, ".git");

    let ret = undefined;

    if (fs.statSync(project, {throwIfNoEntry: false}) === undefined) {
        ret = spawnSync("git", ["clone", `${url}${extraArgs}`, '--recurse-submodules'], {env: process.env});
    } else {
        ret = spawnSync('git', ['pull'], {env: process.env, cwd: project});
    }

    if (ret.status !== 0) {
        console.log(`Status non-0: ${ret.status}`);
        if (ret.stderr)
            console.error(ret.stderr.toString());
        if (ret.stdout)
            console.log(ret.stdout.toString());
        throw new Error(`Git returned an error code ${ret.status}`);
    }

    return project;
}

function gitCheckout(project, rev) {
    const ret = spawnSync("git", ["checkout", rev], {cwd: project});

    if (ret.status !== 0) {
        if (ret.stderr)
            console.error(ret.stderr.toString());
        if (ret.stdout)
            console.log(ret.stdout.toString());

        throw new Error(`Git returned an error code ${ret.status}`);
    }

    return project;
}

function merge(a, b) {
    if (_.isArray(a) && _.isArray(b)) {
        return _.union(a, b);
    } else if (_.isObject(b) && _.isObject(a)) {
        let out = _.extend({}, a);
        for (let k in b) {
            if (a[k]) {
                out[k] = merge(a[k], b[k]);
            } else {
                out[k] = b[k];
            }
        }
        return out;
    }

    return b;
}

function expandServiceTemplate(serviceCompose, translation) {
    function mapping(value) {
        if (_.isArray(value)) {
            return _.map(value, mapping);
        } else if (_.isObject(value)) {
            return _.mapObject(value, mapping);
        } else if (_.isString(value)) {
            let out = value;

            for (const tr in translation) {
                console.log(tr)
                // out = out.replaceAll(`$\{${tr}\}`, translation[tr]);
            }

            return out;
        }

        return value;
    }

    return _.mapObject(serviceCompose, mapping);
}

function fetchService(octoCompose) {
    const oc = octoCompose;

    if (!oc) {
        return undefined;
    }

    if (oc.git) {
        const project = gitFetch(oc.git);
        gitCheckout(project, forcedBranch || oc.branch || "master");
    }

    const octoFileName = path.join(octoCompose.context || ".", octoCompose["octo-compose"] || "octo-compose.yml");
    fs.statSync(octoFileName);
    return octoFileName;
}

function expandOctoCompose(octoDeploy, octoCompose, parentalDockerCompose, parentalDockerServiceName) {
    const octoFileName = fetchService(octoCompose);
    let octoFileContent = undefined;

    if (octoFileName) {
        octoFileContent = fs.readFileSync(octoFileName, 'utf8');
    }

    let octoFileParsed = (octoFileContent ? yml.load(octoFileContent) : {[parentalDockerServiceName]: {}});
    octoCompose = octoCompose || {};
    // console.error("OCTOFIENAME:::", octoFileParsed);

    /**
     *  octo-deploy:
     replicas: 1
     placement:
     - manager
     port-range: 7777
     */
    let replicas = octoDeploy.replicas || 1;
    let placement = octoDeploy.placement;
    if (!placement || placement.length == 0) {
        throw new Error("Key placement must be present and must have at least one index.");
    }

    let portRange = octoDeploy["port-range"];

    if (portRange) {
        if (_.isObject(portRange)) {
            const low = portRange.low;
            if (!low) throw new Error("Low range must be specified");
            const high = portRange.high;
            if (!high) throw new Error("High range must be specified");
            if (low > high) throw new Error("Low must be lower than High");
        } else if (_.isNumber(portRange)) {
            portRange = {low: portRange, high: portRange};
        }
    }

    let iRegistry = (noSwarmP ? "" : octoDeploy.registry || "");
    if (iRegistry.length > 0) {
        iRegistry += "/";
    }

    let trans = {
        INSTANCE_ID: _.range(replicas),
        INSTANCE_PORT: portRange ? _.range(portRange.low, portRange.high + 1) : undefined,
        INSTANCE_TARGET_MACHINE: placement.slice(),
        INSTANCE_REGISTRY: iRegistry,
        CONTEXT: octoCompose.context
    };

    if (portRange && trans.INSTANCE_ID.length > trans.INSTANCE_PORT.length) {
        throw new Error("Allocated port range must be wider than replicas count");
    }

    let services = {};

    /** generate all service replicas */
    for (let i = 0; i < replicas; i++) {
        let composeResult = {};

        const INSTANCE_ID = trans.INSTANCE_ID.shift();
        const INSTANCE_PORT = portRange ? trans.INSTANCE_PORT.shift() : undefined;
        const INSTANCE_TARGET_MACHINE = trans.INSTANCE_TARGET_MACHINE.shift();
        const CONTEXT = trans.CONTEXT;
        const INSTANCE_REGISTRY = trans.INSTANCE_REGISTRY;

        trans.INSTANCE_TARGET_MACHINE.push(INSTANCE_TARGET_MACHINE);

        /** for each service translate a) service name b) replace tags of form ${TAG} */
        for (const service in octoFileParsed) {
            /** Default tags */
            const serviceName = (replicas > 1 ? service + `_${INSTANCE_ID}` : service);

            let instanceTrans = {
                CONTEXT: CONTEXT,
                INSTANCE_ID: INSTANCE_ID,
                INSTANCE_PORT: INSTANCE_PORT,
                INSTANCE_TARGET_MACHINE: INSTANCE_TARGET_MACHINE,
                INSTANCE_NAME: serviceName,
                INSTANCE_REGISTRY: INSTANCE_REGISTRY
            };
            /** User defined tags - use from environment */
            instanceTrans = _.extend(instanceTrans, process.env);

            /** Update octoFileParsed by parentalDockerCompose */
            const updatedOctoFileParsed = merge(octoFileParsed[service], parentalDockerCompose);

            /** Collect results */
            const expService = expandServiceTemplate(updatedOctoFileParsed, instanceTrans);

            composeResult[serviceName] = expService;
        }

        /** merge composeResult to services */
        services = _.extend(services, composeResult);
    }

    return services;
}

function expandClusterCompose(clusterComposePath) {
    let clusterFileContent = fs.readFileSync(clusterComposePath, 'utf8');
    // console.error(clusterFileContent);
    let clusterFileParsed = yml.load(clusterFileContent);

    let out = _.extend({}, clusterFileParsed);
    out.services = {}; /** get rid of services - rebuild is done now */

    for (const s in clusterFileParsed.services) {
        const cService = clusterFileParsed.services[s];
        const octoCompose = cService["octo-compose"];
        const octoDeploy = cService["octo-deploy"];
        const parentalDockerCompose = (prepareHostP ? _.clone(cService) : _.omit(cService, "octo-compose", "octo-deploy", "octo-host-prepare"));

        _.extendOwn(out.services, expandOctoCompose(octoDeploy, octoCompose, parentalDockerCompose, s));
    }

    return out;
}

function runScript(code, envExtenstion) {
    envExtenstion = envExtenstion || {};

    try {
        execSync(code, {env: _.extend(process.env, envExtenstion), stdio: 'inherit'});
    } catch (e) {
        console.error(`Command execution error: ${e.message}`);
        throw new Error(`Script thrown: ${e.message}`);
    }
}

/**
 * Parsing command line inputs to object
 *
 * @return Object command line inputs
 */
function parseCommandLineInputsUsingCommander() {
    const {Command} = require('commander')

    const program = new Command()

    program
        .name('octo-compose')
        .description('Tool designed to join docker-compose files into one, templating support included.')
        .version('1.0', '-v, --version', 'display version for script')

    program
        .option('-i, --input <value>', `path to the input cluster-compose.yml file`, 'cluster-compose.yml')
        .option('-o, --output <value>', `path to the output docker-compose.yml file`)
        .option('-ns, --noSwarm', `disable swarm`, false)
        .option('-hp, --hostPrepare', `start host initialization scripts defined under 'octo-host-prepare' key in cluster-compose.yml`, false)

    program.parse()

    return program.opts()
}

function parseCommandLineInputsUsingCustom() {
    const expected_arguments = {
        input: {type: 'string', required: false},
        output: {type: 'string', required: false},
        noSwarm: {type: 'boolean', required: false, default: true},
        hostPrepare: {type: 'boolean', required: false, default: true},
        help: {type: 'void', required: false},
    }

    let arguments = {}

    const process_argv = process.argv

    for (let i = 0; i < process_argv.length;) {
        let key = process_argv[i]

        if (!key.startsWith('--')) {
            i += 1
            continue
        }

        key = key.substring(2)

        let argument = expected_arguments[key]

        if (!argument) {
            i += 1
            continue
        }

        if (argument.type === 'string') {
            arguments[key] = process_argv[i + 1]
            i += 2
        } else {
            arguments[key] = true

            i += 1
        }
    }

    Object.keys(expected_arguments).forEach(key => {
        if (!(key in arguments) && 'default' in expected_arguments[key]) {
            arguments[key] = expected_arguments[key].default
        }
    })

    if ('help' in arguments) {
        console.log(
            "Usage: octo-compose [-p|--hostPrepare] [-i|--input] [-o|--output] [--noSwarm|-n] [--help|-h]\n\n"
            + `  --input    Path to the input cluster-compose.yml file. Defaults to "${DEFAULT_IN}".\n`
            + "  --output   Path to the output docker-compose.yml file. Defaults to stdout.\n"
            + "  --noSwarm  Use true to disable swarm. Defaults to false.\n"
            + "  --hostPrepare Use true value to start host initialization scripts defined under 'octo-host-prepare' key in cluster-compose.yml. May be set to true only. Stdout is used as inherited scripts stdout then. When used -o argument, stdout of scripts will be its content."
            + "  --help     Print this message and exit.\n");

        process.exit()
    }

    return arguments
}


function main() {
    const options = parseCommandLineInputsUsingCustom()

    const clusterComposePath = options.input || DEFAULT_IN;
    const destComposePath = options.output || 1;
    /** TRICK: 1 = stdout */
    noSwarmP = options.noSwarm;
    prepareHostP = options.hostPrepare
    const clusterJSON = expandClusterCompose(clusterComposePath);

    if (noSwarmP) {
        /** remove .deploy key from services */
        _.each(clusterJSON.services, function (service) {
            delete service.deploy;
        });
    }

    if (prepareHostP) {
        console.log(JSON.stringify(clusterJSON));
        _.each(clusterJSON.services, function (service) {
            let serviceEnv = {};
            _.each(service.environment || [], function (env) {
                const envSplit = env.split("=");
                serviceEnv[envSplit[0]] = envSplit[1];
            });

            let cmds = service["octo-host-prepare"];
            _.each(cmds, _.partial(runScript, _, serviceEnv));
        });
    } else {
        const clusterYML = yml.dump(clusterJSON, {noRefs: true});
        fs.writeFileSync(destComposePath, clusterYML);
    }
}

/*if (conf.hasOwnProperty("--help") || conf.hasOwnProperty("-h")) {
    console.log(
        "Usage: octo-compose [-p|--hostPrepare] [-i|--input] [-o|--output] [--noSwarm|-n] [--help|-h]\n\n"
        + `  --input    Path to the input cluster-compose.yml file. Defaults to "${DEFAULT_IN}".\n`
        + "  --output   Path to the output docker-compose.yml file. Defaults to stdout.\n"
        + "  --noSwarm  Use true to disable swarm. Defaults to false.\n"
        + "  --hostPrepare Use true value to start host initialization scripts defined under 'octo-host-prepare' key in cluster-compose.yml. May be set to true only. Stdout is used as inherited scripts stdout then. When used -o argument, stdout of scripts will be its content."
        + "  --help     Print this message and exit.\n");
    process.exit();
}*/

main();
