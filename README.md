# ErrorExporter

An email error exporter replacement

## Requirements

- Node 16.9 or higher
- Docker (optional)

## Installation

- Clone the repository
- Run `npm install` to install dependencies

## Configuration

### Bot

- Copy screepsCode/ErrorExporter(.js or .ts) to your bot folder and use it the following way: import or require the file, default and static class is exported which you should use to export errors with by executing `ErrorExporter.addErrorToSegment(errorMessage)`.

### Server

- Copy users.json.example to users.json and fill in your information. Name, shard, segment and authentication form are mandatory. Authentication form can be just token for mmo or email and password for private servers.
- Copy .env.example to .env and fill in your [discord webhook url](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks) if you do want this enabled.
- Run `npm run start` or `npm run start:docker` to start in docker

## Usage

After installation is completed it will start to ever hour get your errors and save them by count.

About 200 errors can be saved in an segment per shard. Default is if you are above 90% of the segment it stops exporting and alerts your email via Game.notify in Screeps.

By default port 10003 is used for the api. You can change this at the top of `errorsGetter/index` file. The url is [http://localhost:10003](http://localhost:10003).
