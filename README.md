# octo-compose
> Is a tool designed to join docker-compose files into one, templating support is included. Octo-compose may be used as an alternative to Helm in clean Docker or Docker Swarm environments, input to the `octo-compose` is a set of cluster-compose and octo-compose files and its output is final `docker-compose.yml` for both swarm and non-swarm modes. Octo-compose allows you to significantly reduce redundancy when creating similar Compose files for different configurations and environments such as development, testing, swarm, non-swarm modes. You can use `.env` files to configure your docker-compose deployment easily. You may initiate your hosts via octo compose in one step without manual work. Octo-compose allows you to link services via git, folder and docker registry. Merge process allows you to patch compose files multiple times to enrich final form of the docker-compose file.

# Table of Contents
* [Installation](#installation)
* [File description](#file-description)
  * [cluster-compose.yml](#cluster-composeyml)
  * [Specification of octo-compose.yml](#specification-of-octo-composeyml)
  * [Merge process](#merge-process)
* [Usage](#usage)
* [Links](#links)

# Installation
```sh
npm install octo-compose
```

# File description
## cluster-compose.yml - cluster template file for Docker Swarm
Cluster compose files are intended to define cluster as complex in one point. Cluster compose shares its syntax with `docker-compose.yml` file but extending it with certain useful keys which allows us to merge `octo-composes.yml` from various services. In `cluster-compose.yml` file you define these things:
  * Key `octo-compose` which specifies source for the service (git repo, path - `context` key, octo-compose filename).
  * Key `octo-deploy` specifying deployment-based parameters like:
    * `replicas` - replicas count - the service will be repeated so many times as given natural number (1 ... N) - usage of `replicas` key leads to fullfillment of variable `INSTANCE_ID`,
    * `placement` - possible Docker swarm cluster-node tags,
    * `port-rage` - range of ports reserved to the copies of the service (the range must be equal or greater than `replicas`), assigned port will be present in `INSTANCE_PORT` variable,
  * Key `octo-host-prepare` includes a list of bash script task to do on the host-machine from which the deployment is done, typically these tasks are contained:
    * directory creation,
    * directories/files check existence,
    * default configuration placement if initial run,
    * firewall checks,
    * specific docker service users creation,
    * etc.
  * Other keys can be present according to classic `docker-compose.yml` specification like `volumes`, `ports`, `configs`, etc. can be included.

Cluster compose files can use environment variables as templating variables as well as `octo-compose.yml` file. The usage is the same as in `octo-compose.yml` file i.e. `${TEPLATING_VARIABLE}`

Cluster compose file can be also merged by `octo-compose` script, so you may have multiple `cluster-compose.yml` files used in `octo-compose` script as input (`-i` parameter). Then the result is merged from left to right. It is useful for situation when developer needs to enrich existing project by extra services in only some cases (development vs. production). For example let say you have a `Node.js` service which you test in testing mode without a http server like Nginx, but in production you need Nginx and for example a mail server to sending mails to customers. In this case you could have a `cluster-compose.base.yml` file and `cluster-compose.production.yml` then you may use it as follows:

```bash
$ set -a && source production_service_config.env && set +a && octo-compose -i cluster-compose.base.yml -i cluster-compose.base.yml -o docker-compose.yml
```
## The output
Output of applying of octo-compose on a valid cluster compose file (and depended octo-compose files) is a valid docker compose file which may be used in normal Docker mode (by using `--noSwarm` parameter) or by defaut in Docker Swarm mode.

## Pattern-like cluster-compose.yml specification

```yml
services:
  <service 1>:
    octo-compose: # Optional key
      # Optionally specify git url from which should be the service cloned
      git: <url>
      # Optionally specify git branch or tag to checkout
      branch: <branch/tag name>
      # Defaults to "."
      context: <path/to/service>
      # Defaults to "octo-compose.yml"
      octo-compose: <custom octo-compose.yml>
    # Optional???
    octo-deploy:
      # Defaults to 1???
      replicas: <number of replicas>
      # Define on which machines can the service run. This is ignored when swarm
      # mode is disabled.
      placement:
        - <tag 1>
        ...
        - <tag N>
      port-range:
        # Either a single number (if number of replicas is 1) or a range of
        # ports:
        low: <number>
        high: <number>
      # Docker image registry
      registry: <ip:port>
    octo-host-prepare:
      - "bash script 1" # Templating vars can be contained
      ...
      - "bash script N"
    docker-compose-key1: docker-compose-value1 # Value can also contain templating vars ${...}
    ...
    docker-compose-keyN: docker-compose-valueN
  <service N>:
  ...
```
Note that cluster-compose.yml does not need to include any octo-compose.yml files. Typically you don't need to create octo-compose.yml files for 3rd party images.


## Specification of octo-compose.yml
Octo compose file is an instance of (https://github.com/compose-spec/compose-spec/blob/master/spec.md)[Compose file format] with some specifics. First of all octo compose file format does not specifies key `services` but contains directly its **body** which is a dictionary of services itself. Octo-compose file can include predefined templating vars written as `${VAR}` list of predefined templating vars is follows:

* `CONTEXT` - Equals to `service.octo-compose.context`
* `INSTANCE_ID` - The ID of the instance
* `INSTANCE_NAME` - Equals to `service_<INSTANCE_ID>`
* `INSTANCE_PORT` - The port assigned to the service instance from `service.octo-deploy.port-range`
* `INSTANCE_REGISTRY` - Equals to `service.octo-deploy.registry`
* `INSTANCE_TARGET_MACHINE` - Final cluster placement from `service.octo-deploy.placement`

On top of that list of the templating vars may be extended by **environment** variables - you may use environmental variables as templating vars directly in cluster and octo compose files. If you execute octo-compose like this:

```sh
$ MY_ENV_VAR=foo octo-compose -i cluster-compose.yml
```

You may use it in cluster/octo compose file by `${MY_ENV_VAR}` syntax.

## Merge process
All keys except for `octo-compose` and `octo-deploy` (and their child-keys) are merged recursively. Keys that come first in the merge process have higher priority, e.g. if `cluster-compose.yml` defines ENV `example_1=test_value_1` of `service_a` and corresponding `octo-compose.yml` of the service defines `example_1=test_value_2`, then `test_value_1` is used.

# Host initialization and preparation
In certain situation users need to prepare host machine to a specific state e.g. create specific volume directories, set specific user to certain files etc. For these cases you can specify initialization steps within 'octo-host-prepare' list. Each value is expected to be a valid *bash* script, order of execution is from top to bottom and in synchronous manner. Host preparation is done by this command:
```
$ octo-compose -i my-cluster-compose.yml -hostPrepare # or simply -p
```

# Usage
Octo-compose takes `cluster-compose.yml` as an input and outputs a regular `docker-compose.yml` which you can run using standard docker-compose commands - either in swarm mode or non-swarm mode.

Run `octo-compose -h` to display the help message for more info.

You get these information:
* `--input|-i` - path to the input cluster-compose.yml file. Defaults to "cluster-compose.yml", it may be used more than once, do not mix `-i` and `--input`.
* `--output|-o` -  Path to the output docker-compose.yml file. Defaults to stdout.
* `--noSwarm|-ns` - Use *true* to disable swarm. Defaults to *false*.
* `--hostPrepare|-p` - Use *true* value to start host initialization scripts defined under 'octo-host-prepare' key in cluster-com
d -o argument, stdout of scripts will be its content.
* `--help|-h` Print this message and exit.

# Links
* [Docker Compose Overview](https://docs.docker.com/compose/)
