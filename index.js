// index.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster033.bpxhzqh.mongodb.net/?appName=Cluster033`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db("zapShiftParcels");
        const parcelsCollection = db.collection("parcels");

        // Get parcels by user email using query parameter, sorted by latest first
        // Get all parcels OR parcels by user email (latest first)
        app.get('/parcels', async (req, res) => {
            try {
                const { email } = req.query;

                // if email exists, filter by email, otherwise get all
                const query = email ? { userEmail: email } : {};

                const parcels = await parcelsCollection
                    .find(query)
                    .sort({ creationDate: -1 }) // latest first
                    .toArray();

                res.status(200).json(parcels);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        app.post('/parcels', async (req, res) => {
            try {
                const parcelData = req.body;
                const result = await parcelsCollection.insertOne(parcelData);

                res.status(201).send(result)

            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        app.delete('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const result = await parcelsCollection.deleteOne({
                _id: new ObjectId(id)
            });
            res.send(result);
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


// Basic route
app.get('/', (req, res) => {
    res.send('Parcel Delivery Server is running');
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});