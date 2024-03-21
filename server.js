require('dotenv').config();
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const https = require('https');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { MongoClient, ObjectId } = require('mongodb'); // Ensure ObjectId is imported for use in CRUD operations

const app = express();

const isDebug = process.env.IS_DEBUG;

const prefix = process.env.CODE_PREFIX;

let db; // This will hold the database connection
let dbConnectionError = null; // This will hold any error that occurs during DB connection

// Function to construct MongoDB URI based on environment
function getMongoDBUri() {
  if (process.env.IS_PROD === 'true') {
    // In production, use MongoDB Atlas
    const user = encodeURIComponent(process.env.MONGODB_USER);
    const password = encodeURIComponent(process.env.MONGODB_PASSWORD);
    const clusterUrl = process.env.MONGODB_CLUSTER_URL; // Assuming you add this to your .env for Atlas cluster URL
    return `mongodb+srv://${user}:${password}@${clusterUrl}/?retryWrites=true&w=majority`;
  } else {
    // In development, use local MongoDB
    return process.env.MONGODB_URI || 'mongodb://localhost:27017';
  }
}


// Modify your connectToMongoDB function to catch errors more gracefully
async function connectToMongoDB() {
  const uri = getMongoDBUri(); // Use the function to get the URI based on environment
  const client = new MongoClient(uri); // MongoClient should be defined/imported in your actual code
  
  try {
    await client.connect();
    console.log('Connected successfully to MongoDB');
    const dbName = process.env.MONGODB_DBNAME;
    db = client.db(dbName); // Assign the database connection to the global variable
  } catch (err) {
    console.error('Failed to connect to MongoDB', err);
    dbConnectionError = err; // Store the error for debugging
  }
}

// Call this at the appropriate place in your code
connectToMongoDB().catch(console.error);



console.log("-->", process.env.REACT_URL);
app.use(cors({
  origin: [process.env.REACT_URL],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'OPTIONS','DELETE'],
}));

app.use(express.json());

/* app.get('/', (req, res) => {
  res.send('Hello, world! The repair tracking system is up and running!');
}); */


// Updated route for debugging
app.get('/', (req, res) => {
  const isProd = process.env.IS_PROD === 'true';
  const debugInfo = {
    message: 'Hello, world! The repair tracking system is up and running!',
    environment: isProd ? 'Production' : 'Development',
    mongoDBUri: getMongoDBUri(), // This exposes your URI which might have sensitive info - be cautious
    dbConnectionError: dbConnectionError ? dbConnectionError.message : 'No connection error', // Only send the error message, not the entire error object
  };

  // Optionally remove sensitive info from URI in the response for security
  if(debugInfo.mongoDBUri) {
    debugInfo.mongoDBUri = debugInfo.mongoDBUri.replace(/mongodb\+srv:\/\/(.*):(.*)@/, 'mongodb+srv://[credentials_hidden]@');
  }

  // Send back the debug info as JSON
  res.json(debugInfo);
});

const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET; // Make sure to have a strong secret

// Determine if HTTPS should be used based on an environment variable
const useHttps = process.env.USE_HTTPS === 'true';

let server;
if (useHttps) {
  const options = {
    key: fs.readFileSync('./files/localhost-key.pem'),
    cert: fs.readFileSync('./files/localhost.pem'),
  };
  server = https.createServer(options, app);
  console.log("ici?");
} else {
  server = app; // Use the app directly without HTTPS
}

// Middleware to validate token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Token generation endpoint
app.get('/get-token', (req, res) => {
  // Implement any logic to determine if a token should be issued
  const payload = { status: 'ok' }; // Example payload
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1y' }); // Token expires in 1 hour
  res.json({ token });
});




//------------------------------------------------------------------------------------------------
//                        TEST ROUTE
//------------------------------------------------------------------------------------------------

app.get('/protected', authenticateToken, (req, res) => {
  res.json({ message: "This is protected data." });
});


//------------------------------------------------------------------------------------------------
//                        CRUD FOR CLIENTS
//------------------------------------------------------------------------------------------------

// Add
app.post('/clients', authenticateToken, async (req, res) => {
  try {
    const result = await db.collection("clients_collection").insertOne(req.body);
    res.status(201).send(result);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Read
app.get('/clients', authenticateToken, async (req, res) => {
  try {
    const result = await db.collection("clients_collection").find({}).toArray();
    console.log("-------------------------------------");
    console.log("CLIENTS");
    console.log("-------------------------------------");
    console.log(result);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).send(error.message);
  }
});



app.get('/clients-with-devices', authenticateToken, async (req, res) => {

  try {
    const clients = await db.collection("clients_collection").find().toArray();

    const clientsWithDevices = await Promise.all(clients.map(async (client) => {
      // Since clientID is now stored as an ObjectId, no need to call toString()
      const devices = await db.collection("devices_collection").find({ clientID: client._id }).toArray();
      return {
        ...client,
        devices,
      };
    }));

    console.log("-------------------------------------");
    console.log("CLIENTS WITH DEVICES");
    console.log("-------------------------------------");
    console.log(clientsWithDevices);

    res.status(200).json(clientsWithDevices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


app.get('/clients-with-devices-and-jobs', authenticateToken, async (req, res) => {
  try {
    const clients = await db.collection("clients_collection").find().toArray();

    const clientsWithDevicesAndJobs = await Promise.all(clients.map(async (client) => {
      const devices = await db.collection("devices_collection").find({ clientID: client._id }).toArray();
      
      // For each device, fetch jobs that are not in status 'status5'
      const devicesWithJobs = await Promise.all(devices.map(async (device) => {
        const jobs = await db.collection("repairs_collection").find({
          deviceID: device._id,
          status: { $ne: 'status5' } // Exclude jobs with status 'status5'
        }).toArray();

        // Only return device if it has jobs that are not in status 'status5'
        if (jobs.length > 0) {
          return {
            ...device,
            jobs,
          };
        } else {
          return null; // Device has no jobs or all jobs are in status 'status5', so it's excluded
        }
      }));

      // Filter out null values from devicesWithJobs, which indicates devices without relevant jobs
      const filteredDevicesWithJobs = devicesWithJobs.filter(device => device !== null);

      return {
        ...client,
        devices: filteredDevicesWithJobs,
      };
    }));

    console.log("-------------------------------------");
    console.log("CLIENTS WITH DEVICES AND JOBS");
    console.log("-------------------------------------");
    console.log(clientsWithDevicesAndJobs);

    res.status(200).json(clientsWithDevicesAndJobs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


app.get('/client/:clientId/devices-and-jobs', authenticateToken, async (req, res) => {
  const clientId = req.params.clientId;
  const excludeStatus = req.query.excludeStatus; // "status5" or any other status you want to exclude
  const includeWithoutJobs = req.query.includeWithoutJobs === 'true'; // Convert string to boolean

  try {
    const client = await db.collection("clients_collection").findOne({ _id: new ObjectId(clientId) });
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const devices = await db.collection("devices_collection").find({ clientID: new ObjectId(clientId) }).toArray();

    const devicesWithJobs = await Promise.all(devices.map(async (device) => {
      const query = { deviceID: device._id };
      if (excludeStatus) {
        query.status = { $ne: excludeStatus }; // Dynamically exclude specified status
      }
      const jobs = await db.collection("repairs_collection").find(query).toArray();

      if (jobs.length > 0 || includeWithoutJobs) {
        // Include device if it has jobs not in excludeStatus or if including devices without jobs
        return {
          ...device,
          jobs,
        };
      }
      return null; // Exclude device if it has no jobs or all jobs are in excludeStatus
    }));

    const filteredDevicesWithJobs = devicesWithJobs.filter(device => device !== null);

    console.log("-------------------------------------");
    console.log("CLIENT WITH DEVICES");
    console.log("-------------------------------------");
    console.log("client id :" + clientId);
    console.log(filteredDevicesWithJobs);


    res.status(200).json({
      ...client,
      devices: filteredDevicesWithJobs,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});



/* app.get('/client/:clientId/devices-and-jobs', authenticateToken, async (req, res) => {
  const clientId = req.params.clientId; // Get the client ID from the request parameters

  console.log("ici?????");

  try {
    // Fetch the client by ID
    const client = await db.collection("clients_collection").findOne({ _id: new ObjectId(clientId) });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Fetch devices belonging to the client
    const devices = await db.collection("devices_collection").find({ clientID: new ObjectId(clientId) }).toArray();
    
    // For each device, fetch jobs that are not in status 'status5'
    const devicesWithJobs = await Promise.all(devices.map(async (device) => {
      const jobs = await db.collection("repairs_collection").find({
        deviceID: device._id,
        status: { $ne: 'status5' } // Exclude jobs with status 'status5'
      }).toArray();

      // Only include device if it has jobs that are not in status 'status5'
      if (jobs.length > 0) {
        return {
          ...device,
          jobs,
        };
      } else {
        return null; // Device has no jobs or all jobs are in status 'status5', so it's excluded
      }
    }));

    // Filter out null values from devicesWithJobs, which indicates devices without relevant jobs
    const filteredDevicesWithJobs = devicesWithJobs.filter(device => device !== null);


    console.log("-------------------------------------");
    console.log("CLIENT WITH DEVICES");
    console.log("-------------------------------------");
    console.log("client id :" + clientId);
    console.log(filteredDevicesWithJobs);

    // Return the client with their devices that have at least one job not in status 'status5'
    res.status(200).json({
      ...client,
      devices: filteredDevicesWithJobs,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});  */





// Update
app.put('/clients/:id', authenticateToken, async (req, res) => {
  try {
    const result = await db.collection("clients_collection").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: req.body }
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

/* // Delete
app.delete('/clients/:id', authenticateToken, async (req, res) => {
  try {
    const result = await db.collection("clients_collection").deleteOne({ _id: new ObjectId(req.params.id) });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).send(error.message);
  }
}); */

// Delete client and associated devices and repairs
app.delete('/clients/:id', authenticateToken, async (req, res) => {
  const clientId = new ObjectId(req.params.id);

  try {
    // Step 1: Identify and delete all devices associated with the client
    const devices = await db.collection("devices_collection").find({ clientId: clientId }).toArray();
    if (devices.length > 0) {
      const deviceIds = devices.map(device => device._id);
      // Delete these devices
      await db.collection("devices_collection").deleteMany({ _id: { $in: deviceIds } });

      // Step 2: Delete all repair jobs associated with these devices
      await db.collection("repairs_collection").deleteMany({ deviceId: { $in: deviceIds } });
    }

    // Step 3: Finally, delete the client
    const result = await db.collection("clients_collection").deleteOne({ _id: clientId });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});



app.get('/client-details/:id', authenticateToken, async (req, res) => {
  try {

    console.log("Client ID:", '*' + req.params.id + '*');
    // Fetch all devices for the client
    if(isDebug) {
      console.log("Clientid ?", req.params.clientId);
    }
    // Convert req.params.clientId from string to ObjectId

    let clientObjectId;
    try {
      clientObjectId = new ObjectId(req.params.id); 
       /* clientObjectId = new ObjectId("65e329e16d3e5676c9cf7998");  */
      
    } catch (error) {

      return res.status(400).json({ message: `Invalid client ID format: ${req.params.id}` });
    }

    const devices = await db.collection("devices_collection").find({ clientID: clientObjectId }).toArray();
    if(isDebug) {
      console.log("Devices found:", devices.length); // This should now output the correct number of devices
      console.log("Devices found:", devices); 
    }

    // For each device, fetch the repair jobs
    let clientDetails = await Promise.all(devices.map(async (device) => {
      const repairJobs = await db.collection("repairs_collection").find({ deviceID: device._id }).toArray();
      if(isDebug) {
        console.log("repairJobs found:", repairJobs.length); // This should now output the correct number of devices
        console.log("repairJobs found:", repairJobs); 
      }
      
      // Transform the repair jobs into the desired structure
      return repairJobs.map((job) => ({
        entryDate: new Date(),
        deviceType: device.type,
        brand: device.brand,
        model: device.model,
        serial: device.serial,
        issue: job.issue,
        notes: job.notes,
        emergencyLevel: job.emergencyLevel,
        uniqueCode: job.uniqueCode,
        status: job.status,
        exitDate: job.status === "Completed" ? job.exitDate : null,
        _id: job._id
      }));
    }));

    //console.log ("on est ici ?");
    // Flatten the array of arrays into a single array
    clientDetails = clientDetails.flat();

    // Define a map for emergency levels and statuses to sort by
    const emergencyLevels = { 'High': 3, 'Medium': 2, 'Low': 1 };
    const statusOrder = { 'status1': 1, 'status2': 2, 'status3': 3, 'status4': 4, 'status5': 5 };

    allJobsDetails.sort((a, b) => {
  
      // If entry dates are the same or if sorting by entry date is not desired at this point,
      // proceed to sort by status
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
    
      return 0; // In case all other conditions are equal
    });


    res.status(200).json(clientDetails);
  } catch (error) {
    console.log(error.message)
    res.status(500).json({ message: error.message });
  }
});






//------------------------------------------------------------------------------------------------
//                        CRUD FOR DEVICES
//------------------------------------------------------------------------------------------------

//Add

app.post('/devices', authenticateToken, async (req, res) => {
  console.log("Received request to add a new device with data:", req.body);

  try {
    // Convert clientId from string to ObjectId
    const deviceDataWithObjectId = {
      ...req.body,
      clientID: new ObjectId(req.body.clientId),
    };
    console.log("Converted clientId to ObjectId, attempting to add device for clientId:", deviceDataWithObjectId.clientId);

    const result = await db.collection("devices_collection").insertOne(deviceDataWithObjectId);
    console.log("Device added successfully:", result);

    res.status(201).json(result);
  } catch (error) {
    console.error("Failed to add device:", error);
    res.status(500).json({ message: error.message });
  }
});




//Read 
app.get('/devices',authenticateToken, async (req, res) => {
  try {
    const devices = await db.collection("devices_collection").find({}).toArray();
    res.status(200).json(devices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});



// Update device
app.put('/devices/:id', authenticateToken, async (req, res) => {
  console.log("Updating device with ID:", req.params.id, "with data:", req.body);
  try {
    const result = await db.collection("devices_collection").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: req.body }
    );
    console.log("Update result:", result);
    if (result.modifiedCount === 0) {
      console.log("No documents were updated. This might be because the document does not exist or the data sent in request body is the same as the current one in the database.");
      return res.status(404).json({ message: "Device not found or data unchanged" });
    }
    res.status(200).json(result);
  } catch (error) {
    console.error("Failed to update device:", error);
    res.status(500).json({ message: error.message });
  }
});



/* //delete
app.delete('/devices/:id', authenticateToken, async (req, res) => {
  console.log("we are deleting")
  try {
    //const result = await db.collection("devices_collection").deleteOne({ _id: new ObjectId(req.params.id) });
    //res.status(200).json(result);
    
  } catch (error) {
    //res.status(500).json({ message: error.message });
  }
}); */


app.delete('/devices/:id', authenticateToken, async (req, res) => {
  console.log("Attempting to delete a device and its jobs with ID:", req.params.id);
  try {
    // Step 1: Delete the device
    const deviceDeletionResult = await db.collection("devices_collection").deleteOne({ _id: new ObjectId(req.params.id) });
    console.log(`Device deletion result for ID ${req.params.id}:`, deviceDeletionResult.deletedCount);

    // Check if device was actually deleted before attempting to delete jobs
    if (deviceDeletionResult.deletedCount === 0) {
      console.log(`No device found with ID ${req.params.id}, hence no jobs deleted.`);
      return res.status(404).json({ message: "Device not found" });
    }

    // Step 2: Delete all related jobs (repairs)
    const jobsDeletionResult = await db.collection("repairs_collection").deleteMany({ deviceID: new ObjectId(req.params.id) });
    console.log(`Jobs deletion result for device ID ${req.params.id}:`, jobsDeletionResult.deletedCount);

    // Respond with the results of both operations
    res.status(200).json({
      message: "Device and related jobs deleted successfully",
      deviceDeletionCount: deviceDeletionResult.deletedCount,
      jobsDeletionCount: jobsDeletionResult.deletedCount,
    });
  } catch (error) {
    console.error("Failed to delete device and related jobs:", error);
    res.status(500).json({ message: error.message });
  }
});





//------------------------------------------------------------------------------------------------
//                        CRUD FOR REPAIRS
//------------------------------------------------------------------------------------------------

// Add new job
app.post('/repairs', authenticateToken, async (req, res) => {
  try {
    const { client, device, job } = req.body;

    let clientID;
    let deviceID;

    if(isDebug) {
      console.log('-----------------------')
      console.log(req.body)
      console.log('-----------------------') 
    }

    // Check if it's a new client and create if necessary
    if (!client._id || client._id === "new") {
      const newClientData = {
        firstName: client.firstName,
        lastName: client.lastName,
        phoneNumber: client.phoneNumber,
        email: client.email
      };
      const clientResult = await db.collection("clients_collection").insertOne(newClientData);
      clientID = clientResult.insertedId;
    } else {
      clientID = new ObjectId(client._id);
    }

    // Check if it's a new device and create if necessary
    if (!device._id || device._id === "new") {
      const newDeviceData = {
        clientID: new ObjectId(clientID),
        type: device.type,
        brand: device.brand,
        model: device.model,
        serial: device.serial,
      };
      const deviceResult = await db.collection("devices_collection").insertOne(newDeviceData);
      deviceID = deviceResult.insertedId;
    } else {
      deviceID = new ObjectId(device._id);
    }

    
    // Generate a unique code for the job
    //const uniqueCode = generateUniqueCode(); // Ensure this function is implemented and generates a unique code
    const uniqueCode = prefix + await getNextJobID();
    console.log(uniqueCode);




    // Prepare and insert the new job
    const newJobData = {
      deviceID: deviceID,
      entryDate: new Date(), // Format current date as string
      exitDate: job.exitDate, // Format or null if not provided
      emergencyLevel: job.emergencyLevel,
      status: job.status,
      uniqueCode: uniqueCode,
      issue: job.issue,
      notes: job.notes
    };

    const jobResult = await db.collection("repairs_collection").insertOne(newJobData);

    res.status(201).json({ message: "Repair job added successfully", job: newJobData });
  } catch (error) {
    console.error("Error adding repair job:", error);
    res.status(500).json({ message: "Failed to add repair job", error: error.message });
  }
});


async function getNextJobID() {
  try {
    // Find the counter document (your jobid collection should have only one document)
    const counterDoc = await db.collection("jobsid_collection").findOne(); 

    // Increment the sequence
    const result = await db.collection("jobsid_collection").findOneAndUpdate(
      { _id: counterDoc._id },  // Target the document using its existing _id
      { $inc: { sequence_value: 1 } }, 
      { returnNewDocument: true } 
    );

    //console.log("result:", result);
    //console.log("result2:", result.sequence_value + 1);
    return result.sequence_value + 1; 
  } catch (error) {
    console.error("Error getting next job ID:", error);
    throw error; 
  }
}

/*
function generateUniqueCode() {
  // Get the current date and time
  const now = new Date();

  // Format the date and time components
  const day = now.getDate().toString().padStart(2, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0'); // +1 because months are 0-indexed
  const year = now.getFullYear().toString().slice(-2); // Just get the last two digits of the year

  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');

  // Construct the code
  const code = `${prefix}-${day}${month}${year}-${hours}${minutes}${seconds}`;

  return code;
}*/


// Endpoint to fetch a specific job's details along with the related device and client
app.get('/repairs_get_infos/:jobId', authenticateToken, async (req, res) => {

  console.log("----------------------");
  console.log("----------------------");

  
  try {
    const { jobId } = req.params;

    // Fetch the specific job by its ID
    const job = await db.collection("repairs_collection").findOne({ _id: new ObjectId(jobId) });
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    // Construct the response object with job, device, and client details
    const responseObj = {
        id: job._id,
        entryDate: job.entryDate,
        exitDate: job.exitDate,
        emergencyLevel: job.emergencyLevel,
        status: job.status,
        uniqueCode: job.uniqueCode,
        issue: job.issue,
        notes: job.notes
    };

    if(isDebug) {
      console.log("----------------");
      console.log("JOB INFOS");
      console.log("----------------");
      console.log (responseObj);
      console.log("----------------");
    }

    res.json(responseObj);
  } catch (error) {
    console.error("Error fetching job details:", error);
    res.status(500).json({ message: "Failed to fetch job details", error: error.message });
  }
});



//read
app.get('/repairs', authenticateToken, async (req, res) => {
  try {
    const repairs = await db.collection("repairs_collection").find({}).toArray();
    res.status(200).json(repairs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update a repair job with potential new client or device
app.put('/repairs/:id', authenticateToken, async (req, res) => {
  try {
    const jobId = new ObjectId(req.params.id);
    const { client, device, job } = req.body;

    // Initialize clientID and deviceID
    let clientID, deviceID;
    clientID = new ObjectId(client._id);
    deviceID = new ObjectId(device._id);
    

    // Update the repair job
    const updateResult = await db.collection("repairs_collection").updateOne(
      { _id: jobId },
      {
        $set: {
          deviceID: deviceID,
          // Note: entryDate and uniqueCode are not updated
          /* exitDate: job.exitDate, */
          emergencyLevel: job.emergencyLevel,
          status: job.status,
          issue: job.issue,
          notes: job.notes,
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ message: "Repair job not found." });
    }

    res.status(200).json({ message: "Repair job updated successfully." });
  } catch (error) {
    console.error("Error updating repair job:", error);
    res.status(500).json({ message: "Failed to update repair job", error: error.message });
  }
});


/* //update
app.put('/repairs/:id', authenticateToken, async (req, res) => {
  try {
    const result = await db.collection("repairs_collection").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: req.body }
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}); */


app.put('/repairs_status/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status, exitDate } = req.body; // Capture status and optionally an exit date from the request body

  try {
    // Prepare the data to be updated, including status and conditionally the exit date
    const updateData = { status };
    if (exitDate) {
      updateData.exitDate = new Date(exitDate); // Format the provided exit date
    } else if (status === "status5") {
      updateData.exitDate = new Date(); // Use current date if marking as completed without a specific exit date
    }

    // Execute the update operation
    const result = await db.collection("repairs_collection").updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    // Handle cases where the job is not found
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Repair job not found" });
    }

    // Respond with success if the job was found and updated
    res.status(200).json({ message: "Repair job status updated successfully" });
  } catch (error) {
    console.error("Error updating repair job status:", error);
    res.status(500).json({ message: "Failed to update repair job status", error: error.toString() });
  }
});



//delete
app.delete('/repairs/:id', authenticateToken, async (req, res) => {
  try {
    const result = await db.collection("repairs_collection").deleteOne({ _id: new ObjectId(req.params.id) });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// List all the repairs job
app.get('/repair-jobs', authenticateToken, async (req, res) => {
  try {
    // Fetch all repair jobs
    const repairJobs = await db.collection("repairs_collection").find({}).toArray();

    if(isDebug) {
      console.log()
    }


    let allJobsDetails = await Promise.all(repairJobs.map(async (job) => {
      const device = await db.collection("devices_collection").findOne({ _id: new ObjectId(job.deviceID) });
      
      // If the device is not found, skip or handle accordingly
      if (!device) {
        console.log(`Device not found for job ID: ${job._id}`);
        // Skip this job or handle the missing device case here
        // For example, return null and filter out later, or return a job with placeholder device info
        return null; // Example: Skipping the job
      }
      
      const client = await db.collection("clients_collection").findOne({ _id: new ObjectId(device.clientID) });
      
      // It's also a good idea to check if client is null
      if (!client) {
        console.log(`Client not found for device ID: ${job.deviceID}`);
        // Handle the missing client case similarly
        return null; // Or handle differently
      }
      
      // Proceed with job detail assembly as before
      return {
        ...job,
        deviceID : device._id,
        deviceType: device.type,
        brand: device.brand,
        model: device.model,
        serial: device.serial,
        issue: job.issue,
        notes: job.notes,
        emergencyLevel: job.emergencyLevel,
        clientID : client._id,
        clientName: `${client.firstName} ${client.lastName}`,
        clientFirstname : client.firstName,
        clientLastname : client.lastName,
        clientEmail: client.email,
        clientPhone: client.phoneNumber,
      };
    })).then(results => results.filter(job => job !== null)); // Filter out any nulls from skipped jobs
    

    // Sorting logic remains the same



  const emergencyLevels = { 'High': 3, 'Medium': 2, 'Low': 1 };
  const statusOrder = { 'status1': 1, 'status2': 2, 'status3': 3, 'status4': 4, 'status5': 5 };

  allJobsDetails.sort((a, b) => {
  
    // If entry dates are the same or if sorting by entry date is not desired at this point,
    // proceed to sort by status
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
  
    return 0; // In case all other conditions are equal
  });
  
    console.log(allJobsDetails);

    res.status(200).json(allJobsDetails);
  } catch (error) {
    res.status(500).json({ message : error.message });
    
  }
});



server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT} (${useHttps ? 'HTTPS' : 'HTTP'})`);
  });