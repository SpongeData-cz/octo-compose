# octo-compose
> Tool designed to join docker-compose files into one, templating support included.

# Table of Contents
* [Installation](#installation)
* [File description](#file-description)
  * [cluster-compose.yml](#cluster-composeyml)
  * [octo-compose.yml](#octo-composeyml)
  * [Merge process](#merge-process)
* [Usage](#usage)
* [Links](#links)

# Installation
```sh
git clone https://10.0.0.105:10443/octopus/octo-compose
npm i octo-compose/ -g
```

# File description
## cluster-compose.yml
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


## octo-compose.yml
A regular docker-compose file with custom templating vars written as `${VAR}`:

* `CONTEXT` - Equals to `service.octo-compose.context`
* `INSTANCE_ID` - The ID of the instance
* `INSTANCE_NAME` - Equals to `service_<INSTANCE_ID>`
* `INSTANCE_PORT` - The port assigned to the service instance from `service.octo-deploy.port-range`
* `INSTANCE_REGISTRY` - Equals to `service.octo-deploy.registry`
* `INSTANCE_TARGET_MACHINE` - Final cluster placement from `service.octo-deploy.placement`

Note that list of the temaplating vars is extended by **environment** variables.

## Merge process
All keys except for `octo-compose` and `octo-deploy` (and their child-keys) are merged recursively. Keys that come first in the merge process have higher priority, e.g. if `cluster-compose.yml` defines ENV `example_1=test_value_1` of `service_a` and corresponding `octo-compose.yml` of the service defines `example_1=test_value_2`, then `test_value_1` is used.

# Host initialization and preparation
In certain situation users need to prepare host machine to a specific state e.g. create specific volume directories, set specific user to certain files etc. For these cases you can specify initialization steps within 'octo-host-prepare' list. Each value is expected to be a valid *bash* script, order of execution is from top to bottom and in synchronous manner. Host preparation is done by this command:
```
$ octo-compose -i my-cluster-compose.yml --hostPrepare
```

# Usage
Octo-compose takes `cluster-compose.yml` as an input and outputs a regular `docker-compose.yml` which you can run using standard docker-compose commands - either in swarm mode or non-swarm mode.

Run `octo-compose -h` to display the help message for more info.

# Links
* [Docker Compose Overview](https://docs.docker.com/compose/)
