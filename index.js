#!/usr/bin/env node
require('dotenv').config();
var packageJson = require("./package.json");
var fs = require("fs");

var AWS = require("aws-sdk");
var AWSCognito = require("amazon-cognito-identity-js");
var apigClientFactory = require("aws-api-gateway-client").default;
var WindowMock = require("window-mock").default;

global.window = { localStorage: new WindowMock().localStorage };
global.navigator = function() {
  return null;
};

var options = require("yargs")
  .option("params", {
    describe: "Params",
    demandOption: true,
    string: true
  })
  .option("stage", {
    describe: "Serverless deploy stage",
    demandOption: true,
    default: "dev"
  })

  .option("path-template", {
    describe: "API path template",
    demandOption: true
  })
  .option("method", {
    describe: "API method",
    default: "GET"
  })
  .option("params", {
    describe: "API request params",
    default: "{}"
  })
  .option("additional-params", {
    describe: "API request additional params",
    default: "{}"
  })
  .option("body", {
    describe: "API request body",
    default: "{}"
  })
  .option("access-token-header", {
    describe: "Header to use to pass access token with request"
  })
  .help("h")
  .alias("h", "help")
  .alias("v", "version")
  .version(packageJson.version)
  .wrap(null).argv;

const argv = {
  userPoolId: process.env.USER_POOL_ID,
  appClientId: process.env.APP_CLIENT_ID,
  cognitoRegion: process.env.COGNITO_REGION,
  identityPoolId: process.env.IDENTITY_POOL_ID,
  apiKey: process.env.APP_CLIENT_ID,
  apiGatewayRegion: process.env.API_GATEWAY_REGION,
  invokeUrl: process.env.INVOKE_URL,
  username: process.env.USERNAME,
  password: process.env.PASSWORD
}
function authenticate(callback) {
  var poolData = {
    UserPoolId: argv.userPoolId,
    ClientId: argv.appClientId
  };

  AWS.config.update({ region: argv.cognitoRegion });
  var userPool = new AWSCognito.CognitoUserPool(poolData);

  var userData = {
    Username: argv.username,
    Pool: userPool
  };
  var authenticationData = {
    Username: argv.username,
    Password: argv.password
  };
  var authenticationDetails = new AWSCognito.AuthenticationDetails(
    authenticationData
  );

  var cognitoUser = new AWSCognito.CognitoUser(userData);

  console.log("Authenticating with User Pool");

  cognitoUser.authenticateUser(authenticationDetails, {
    onSuccess: function(result) {
      callback({
        idToken: result.getIdToken().getJwtToken(),
        accessToken: result.getAccessToken().getJwtToken()
      });
    },
    onFailure: function(err) {
      console.log(err.message ? err.message : err);
    },
    newPasswordRequired: function() {
      console.log("Given user needs to set a new password");
    },
    mfaRequired: function() {
      console.log("MFA is not currently supported");
    },
    customChallenge: function() {
      console.log("Custom challenge is not currently supported");
    }
  });
}

function getCredentials(userTokens, callback) {
  console.log("Getting temporary credentials");

  var logins = {};
  var idToken = userTokens.idToken;
  var accessToken = userTokens.accessToken;

  logins[
    "cognito-idp." + argv.cognitoRegion + ".amazonaws.com/" + argv.userPoolId
  ] = idToken;

  AWS.config.credentials = new AWS.CognitoIdentityCredentials({
    IdentityPoolId: argv.identityPoolId,
    Logins: logins
  });

  AWS.config.credentials.get(function(err) {
    if (err) {
      console.log(err.message ? err.message : err);
      return;
    }

    callback(userTokens);
  });
}

function makeRequest(userTokens) {
  console.log("Making API request");
  const clientParams = {
    apiKey: argv.apiKey,
    accessKey: AWS.config.credentials.accessKeyId,
    secretKey: AWS.config.credentials.secretAccessKey,
    sessionToken: AWS.config.credentials.sessionToken,
    region: argv.apiGatewayRegion,
    invokeUrl: argv.invokeUrl + options.stage
  };
  var apigClient = apigClientFactory.newClient(clientParams);

  var params = JSON.parse(options.params);
  var additionalParams = JSON.parse(options.additionalParams);

  var body = "";
  if (options.body.startsWith("@")) {
    // Body from file
    const bodyFromFile = options.body.replace(/^@/, "");
    const contentFromFile = fs.readFileSync(bodyFromFile);
    body = JSON.parse(contentFromFile);
  }
  else {
    body = JSON.parse(options.body);
  }

  if (options.accessTokenHeader) {
    const tokenHeader = {};
    tokenHeader[options.accessTokenHeader] = userTokens.accessToken;
    additionalParams.headers = Object.assign(
      {},
      additionalParams.headers,
      tokenHeader
    );
  }

  apigClient
    .invokeApi(params, options.pathTemplate, options.method, additionalParams, body)
    .then(function(result) {
      console.dir({
        status: result.status,
        statusText: result.statusText,
        data: result.data
      });
    })
    .catch(function(result) {
      if (result.response) {
        console.dir({
          status: result.response.status,
          statusText: result.response.statusText,
          data: result.response.data
        });
      } else {
        console.log(result.message);
      }
    });
}

authenticate(function(tokens) {
  getCredentials(tokens, makeRequest);
});
