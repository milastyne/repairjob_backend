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

let db; // This will hold the database connection

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

// Initialize MongoDB Connection
async function connectToMongoDB() {
  const uri = getMongoDBUri(); // Use the function to get the URI based on environment
  const client = new MongoClient(uri); // Remove deprecated options
  
  try {
    await client.connect();
    console.log('Connected successfully to MongoDB');
    const dbName = process.env.MONGODB_DBNAME;
    db = client.db(dbName); // Assign the database connection to the global variable
  } catch (err) {
    console.error('Failed to connect to MongoDB', err);
  }
}

connectToMongoDB().catch(console.error);


connectToMongoDB().catch(console.error);



/* // MongoDB setup
const url = process.env.MONGODB_URI || 'mongodb://localhost:27017'; // Use MONGODB_URI from .env or fallback to localhost
const dbName = 'repairjob_db';
let db; // This will hold the database connection

const isDebug = process.env.IS_DEBUG;

// Initialize MongoDB Connection
async function connectToMongoDB() {
  const client = new MongoClient(url);
  await client.connect();
  console.log('Connected successfully to MongoDB');
  db = client.db(dbName); // Assign the database connection to the global variable
}

connectToMongoDB().catch(console.error); */




app.use(cors({
  origin: [process.env.REACT_URL],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'OPTIONS','DELETE'],
}));

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello, world! The repair tracking system is up and running!');
});

const PORT = process.env.PORT || 3000;
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

    res.status(200).json(clientsWithDevices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});



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
    const statusOrder = { 'In Progress': 3, 'Pending': 2, 'Completed': 1 };

    clientDetails.sort((a, b) => {
      // Sort by entry date in descending order first
      const dateComparison = new Date(b.entryDate) - new Date(a.entryDate);
      if (dateComparison !== 0) return dateComparison;
    
      // If entry dates are the same or if sorting by entry date is not desired at this point,
      // proceed to sort by status
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[b.status] - statusOrder[a.status];
      }
    
      // If statuses are the same and not 'Completed', sort by emergency level
      if (a.status !== 'Completed' && b.status !== 'Completed') {
        return emergencyLevels[b.emergencyLevel] - emergencyLevels[a.emergencyLevel];
      }
    
      // Additional sorting logic if needed
    
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
  try {
    const result = await db.collection("devices_collection").insertOne(req.body);
    res.status(201).json(result);
  } catch (error) {
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


//Update
app.put('/devices/:id', authenticateToken, async (req, res) => {
  try {
    const result = await db.collection("devices_collection").updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: req.body }
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


//delete
app.delete('/devices/:id', authenticateToken, async (req, res) => {
  try {
    const result = await db.collection("devices_collection").deleteOne({ _id: new ObjectId(req.params.id) });
    res.status(200).json(result);
  } catch (error) {
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
        model: device.model
      };
      const deviceResult = await db.collection("devices_collection").insertOne(newDeviceData);
      deviceID = deviceResult.insertedId;
    } else {
      deviceID = new ObjectId(device._id);
    }

    // Generate a unique code for the job
    const uniqueCode = generateUniqueCode(); // Ensure this function is implemented and generates a unique code

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

  const prefix = env.process.CODE_PREFIX;
  // Construct the code
  const code = `${prefix}-${day}${month}${year}-${hours}${minutes}${seconds}`;

  return code;
}


// Endpoint to fetch a specific job's details along with the related device and client
app.get('/repairs_get_infos/:jobId', authenticateToken, async (req, res) => {
  
  try {
    const { jobId } = req.params;

    // Fetch the specific job by its ID
    const job = await db.collection("repairs_collection").findOne({ _id: new ObjectId(jobId) });
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    // Fetch the related device
    const device = await db.collection("devices_collection").findOne({ _id: job.deviceID });
    if (!device) {
      return res.status(404).json({ message: "Device not found for this job" });
    }

    // Fetch the client related to the device
    const client = await db.collection("clients_collection").findOne({ _id: device.clientID });
    if (!client) {
      return res.status(404).json({ message: "Client not found for this device" });
    }

    // Construct the response object with job, device, and client details
    const responseObj = {
      job: {
        id: job._id,
        entryDate: job.entryDate,
        exitDate: job.exitDate,
        emergencyLevel: job.emergencyLevel,
        status: job.status,
        uniqueCode: job.uniqueCode,
        issue: job.issue,
        notes: job.notes
      },
      device: {
        id: device._id,
        type: device.type,
        brand: device.brand,
        model: device.model
      },
      client: {
        id: client._id,
        firstName: client.firstName,
        lastName: client.lastName,
        phoneNumber: client.phoneNumber,
        email: client.email
      }
    };

    if(isDebug) {
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

    // Check for client updates or additions
    if (client._id === "new") {
      // Insert new client and get ID
      const clientResult = await db.collection("clients_collection").insertOne({
        firstName: client.firstName,
        lastName: client.lastName,
        phoneNumber: client.phoneNumber,
        email: client.email,
      });
      clientID = clientResult.insertedId;
    } else {
      // Use existing client ID
      clientID = new ObjectId(client._id);
    }

    // Check for device updates or additions
    if (device._id === "new") {
      // Insert new device and get ID
      const deviceResult = await db.collection("devices_collection").insertOne({
        clientID: clientID,
        type: device.type,
        brand: device.brand,
        model: device.model,
      });
      deviceID = deviceResult.insertedId;
    } else {
      // Use existing device ID
      deviceID = new ObjectId(device._id);
    }

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
    } else if (status === "Completed") {
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
      const client = await db.collection("clients_collection").findOne({ _id: new ObjectId(device.clientID) });

      // Assuming client and device are always found. Add null checks if necessary.
      return {
        ...job,
        deviceType: device.type,
        brand: device.brand,
        model: device.model,
        // issue and notes are now correctly taken from the job object itself
        issue: job.issue,
        notes: job.notes,
        emergencyLevel: job.emergencyLevel,
        clientName: `${client.firstName} ${client.lastName}`,
        clientEmail: client.email,
      };
    }));

    // Sorting logic remains the same



  const emergencyLevels = { 'High': 3, 'Medium': 2, 'Low': 1 };
  const statusOrder = { 'In Progress': 3, 'Pending': 2, 'Completed': 1 };

  allJobsDetails.sort((a, b) => {
    // Sort by entry date in descending order first
    const dateComparison = new Date(b.entryDate) - new Date(a.entryDate);
    if (dateComparison !== 0) return dateComparison;
  
    // If entry dates are the same or if sorting by entry date is not desired at this point,
    // proceed to sort by status
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[b.status] - statusOrder[a.status];
    }
  
    // If statuses are the same and not 'Completed', sort by emergency level
    if (a.status !== 'Completed' && b.status !== 'Completed') {
      return emergencyLevels[b.emergencyLevel] - emergencyLevels[a.emergencyLevel];
    }
  
    // Additional sorting logic if needed
  
    return 0; // In case all other conditions are equal
  });
  

/*     allJobsDetails.sort((a, b) => {
      // First, sort by status
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[b.status] - statusOrder[a.status];
      }
      // If statuses are the same and not 'Completed', sort by emergency level
      if (a.status !== 'Completed' && b.status !== 'Completed') {
        if (emergencyLevels[b.emergencyLevel] !== emergencyLevels[a.emergencyLevel]) {
          return emergencyLevels[b.emergencyLevel] - emergencyLevels[a.emergencyLevel];
        }
      }
    });    */


    res.status(200).json(allJobsDetails);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});



server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT} (${useHttps ? 'HTTPS' : 'HTTP'})`);
  });