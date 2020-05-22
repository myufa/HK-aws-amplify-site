/*
Copyright 2017 - 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with the License. A copy of the License is located at
    http://aws.amazon.com/apache2.0/
or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
*/

/* Amplify Params - DO NOT EDIT
	ENV
	REGION
	STORAGE_USERTABLE_ARN
	STORAGE_USERTABLE_NAME
Amplify Params - DO NOT EDIT */

const AWS = require('aws-sdk')
var awsServerlessExpressMiddleware = require('aws-serverless-express/middleware')
var bodyParser = require('body-parser')
var express = require('express')
var formData = require('./formData')
const util = require('util')
const googleToUnix = require('./utils').googleToUnix
const unixToGoogle = require('./utils').unixToGoogle

AWS.config.update({ region: process.env.TABLE_REGION });

const dynamodb = new AWS.DynamoDB.DocumentClient();

let tableName = "Users";
if(process.env.ENV && process.env.ENV !== "NONE") {
  tableName = tableName + '-' + process.env.ENV;
}

const userIdPresent = false; // TODO: update in case is required to use that definition
const partitionKeyName = "id";
const partitionKeyType = "N";
const sortKeyName = "";
const sortKeyType = "";
const hasSortKey = sortKeyName !== "";
const path = "/items";
const UNAUTH = 'UNAUTH';
const hashKeyPath = '/:' + partitionKeyName;
const sortKeyPath = hasSortKey ? '/:' + sortKeyName : '';
// declare a new express app
var app = express()
app.use(bodyParser.json())
app.use(awsServerlessExpressMiddleware.eventContext())

// declare a new collector
var collector = new formData();

// Enable CORS for all methods
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
  next()
});


// convert url string param to expected Type
const convertUrlType = (param, type) => {
  switch(type) {
    case "N":
      return Number.parseInt(param);
    default:
      return param;
  }
}

const updateDBHelper = async (form_rows) => {
  console.log("updateDB check 2", form_rows[form_rows.length - 1]);
  let putItemParams = {
    RequestItems: {
      [tableName]: form_rows.map((row)=>{
        return {
          PutRequest: {
            Item: { 
              id: googleToUnix(row[0]), 
              content: row[1],
              name: row[2]
            }
          }
        }
      })
    }
  }
  dynamodb.batchWrite(putItemParams, (err, data) => {
    if(err) {
      console.log("batchwrite error", err);
      return err;
    } else{
      console.log({success: 'post call succeed!', data: data});
    }
  });
}

const updateDB = async () => {
  const form_rows = await collector.get_records().then((data)=>{
    return data;
  })
  .catch((err)=>{
    return Error("its ok, you'll get it next time!");
  });
  const last_form_date = googleToUnix(form_rows[form_rows.length - 1][0]);
  const queryParams = { TableName: tableName };
  const db_rows_prom = await dynamodb.scan(queryParams, (err, data) => {    
    if (err) {      
      return Error("Could not load items: ");    
    } else {      return data.Items    }
  }).promise(); 
  console.log("db rows check [prom, items]", db_rows_prom, db_rows_prom.Items, !db_rows_prom.Items.length)
  if(!Array.isArray(db_rows_prom.Items) || !db_rows_prom.Items.length){
    print("updateDB check", form_rows[form_rows.length - 1]);
    await updateDBHelper(form_rows);
    return "No data in db, updated from form";
  }
  const db_rows = db_rows_prom.Items;
  const last_db_date = db_rows[db_rows.length - 1].id;
  console.log("form update check [form, db]", last_form_date, last_db_date, last_form_date > last_db_date)
  console.log("form update check in dates [form, db]", form_rows[form_rows.length - 1][0] , unixToGoogle(last_db_date))
  console.log("form update check in names", form_rows[form_rows.length - 1][2], db_rows[db_rows.length - 1].name)
  if (last_form_date > last_db_date){
    await updateDBHelper(form_rows);
    return "data in db did not include most recent, updated from form";
  }
}

/********************************
 * HTTP Get method for list objects *
 ********************************/

app.get(path, async function(req, res) { 
  const updateDBStatus = await updateDB();
  console.log(updateDBStatus);
  const queryParams = { TableName: tableName };
  // comment
  dynamodb.scan(queryParams, (err, data) => {    
    if (err) {      
      res.json({ error: "Could not load items: " + err });    
    } else {      res.json(data.Items);    }
  });
});


app.get("/form-data", (req, res)=>{
  collector.get_records().then((data)=>{
    res.json({formData: data});
  })
  .catch((err)=>{
    res.json({error: err, comfortingMessage: "its ok, you'll get it next time!"});
  });
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
});


// app.get(path + hashKeyPath, function(req, res) {
//   var condition = {}
//   condition[partitionKeyName] = {
//     ComparisonOperator: 'EQ'
//   }

//   if (userIdPresent && req.apiGateway) {
//     condition[partitionKeyName]['AttributeValueList'] = [req.apiGateway.event.requestContext.identity.cognitoIdentityId || UNAUTH ];
//   } else {
//     try {
//       condition[partitionKeyName]['AttributeValueList'] = [ convertUrlType(req.params[partitionKeyName], partitionKeyType) ];
//     } catch(err) {
//       res.statusCode = 500;
//       res.json({error: 'Wrong column type ' + err});
//     }
//   }

//   let queryParams = {
//     TableName: tableName,
//     KeyConditions: condition
//   }

//   dynamodb.query(queryParams, (err, data) => {
//     if (err) {
//       res.statusCode = 500;
//       res.json({error: 'Could not load items: ' + err});
//     } else {
//       res.json(data.Items);
//     }
//   });
// });

/*****************************************
 * HTTP Get method for get single object *
 *****************************************/

app.get(path + '/object' + hashKeyPath + sortKeyPath, function(req, res) {
  var params = {};
  if (userIdPresent && req.apiGateway) {
    params[partitionKeyName] = req.apiGateway.event.requestContext.identity.cognitoIdentityId || UNAUTH;
  } else {
    params[partitionKeyName] = req.params[partitionKeyName];
    try {
      params[partitionKeyName] = convertUrlType(req.params[partitionKeyName], partitionKeyType);
    } catch(err) {
      res.statusCode = 500;
      res.json({error: 'Wrong column type ' + err});
    }
  }
  if (hasSortKey) {
    try {
      params[sortKeyName] = convertUrlType(req.params[sortKeyName], sortKeyType);
    } catch(err) {
      res.statusCode = 500;
      res.json({error: 'Wrong column type ' + err});
    }
  }

  let getItemParams = {
    TableName: tableName,
    Key: params
  }

  dynamodb.get(getItemParams,(err, data) => {
    if(err) {
      res.statusCode = 500;
      res.json({error: 'Could not load items: ' + err.message});
    } else {
      if (data.Item) {
        res.json(data.Item);
      } else {
        res.json(data) ;
      }
    }
  });
});


/************************************
* HTTP put method for insert object *
*************************************/

app.put(path, function(req, res) {

  if (userIdPresent) {
    req.body['userId'] = req.apiGateway.event.requestContext.identity.cognitoIdentityId || UNAUTH;
  }

  let putItemParams = {
    TableName: tableName,
    Item: req.body
  }
  dynamodb.put(putItemParams, (err, data) => {
    if(err) {
      res.statusCode = 500;
      res.json({error: err, url: req.url, body: req.body});
    } else{
      res.json({success: 'put call succeed!', url: req.url, data: data})
    }
  });
});

/************************************
* HTTP post method for insert object *
*************************************/

app.post(path, function(req, res) {

  if (userIdPresent) {
    req.body['userId'] = req.apiGateway.event.requestContext.identity.cognitoIdentityId || UNAUTH;
  }

  let putItemParams = {
    TableName: tableName,
    Item: req.body
  }
  dynamodb.put(putItemParams, (err, data) => {
    if(err) {
      res.statusCode = 500;
      res.json({error: err, url: req.url, body: req.body});
    } else{
      res.json({success: 'post call succeed!', url: req.url, data: data})
    }
  });
});

/**************************************
* HTTP remove method to delete object *
***************************************/

app.delete(path + '/object' + hashKeyPath + sortKeyPath, async function(req, res) {
  var params = {};
  if (userIdPresent && req.apiGateway) {
    params[partitionKeyName] = req.apiGateway.event.requestContext.identity.cognitoIdentityId || UNAUTH;
  } else {
    params[partitionKeyName] = req.params[partitionKeyName];
     try {
      params[partitionKeyName] = convertUrlType(req.params[partitionKeyName], partitionKeyType);
    } catch(err) {
      res.statusCode = 500;
      res.json({error: 'Wrong column type ' + err});
    }
  }
  if (hasSortKey) {
    try {
      params[sortKeyName] = convertUrlType(req.params[sortKeyName], sortKeyType);
    } catch(err) {
      res.statusCode = 500;
      res.json({error: 'Wrong column type ' + err});
    }
  }
  
  await collector.delete_records(params[partitionKeyName])
  .catch(err => {
    console.log("collector delete error", err)
  });

  let removeItemParams = {
    TableName: tableName,
    Key: params
  }
  dynamodb.delete(removeItemParams, (err, data)=> {
    if(err) {
      res.statusCode = 500;
      res.json({error: err, url: req.url});
    } else {
      res.json({url: req.url, data: data});
    }
  });
});
app.listen(3000, function() {
    console.log("App started")
});

// Export the app object. When executing the application local this does nothing. However,
// to port it to AWS Lambda we will create a wrapper around that will load the app from
// this file
module.exports = app
