// index.js
const express = require('express');
const cors = require('cors');
const Stripe = require("stripe");
const admin = require("firebase-admin");

require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const serviceAccount = require("./firebase-admin-key.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


const stripe = new Stripe(process.env.PAYMENT_GATEWAY_KEY);

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
        const usersCollection = db.collection("users");
        const parcelsCollection = db.collection("parcels");
        const paymentsCollection = db.collection("payments");
        const ridersCollection = db.collection("riders");
        const trackingCollection = db.collection("tracking");

        // custom middleware
        const verifyFBToken = async (req, res, next) => {
            // Implement Firebase token verification logic here
            const authHeader = req.headers.authorization;
            console.log(authHeader);
            // If not, return res.status(401).json({ message: "Unauthorized" });
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                return res.status(401).json({ message: "Unauthorized access" });
            }
            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).json({ message: "Unauthorized access" });
            }
            // If verified, call next()

            try {
                const decoded = await admin.auth().verifyIdToken(token)
                req.decoded = decoded
                next();
            } catch (error) {
                return res.status(403).json({ message: "forbidden access" });
            }
        }

        app.post('/users', async (req, res) => {
            try {
                const email = req.body.email;

                const existingUser = await usersCollection.findOne({ email: email });
                if (existingUser) {
                    return res.status(200).json({ message: "User already exists", inserted: false });
                }
                const userData = req.body;
                const result = await usersCollection.insertOne(userData);

                res.send(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Get parcels by user email using query parameter, sorted by latest first
        // Get all parcels OR parcels by user email (latest first)
        app.get('/parcels', verifyFBToken, async (req, res) => {
            try {
                const { email } = req.query;
                console.log(req.headers, 'authorization');

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


        app.get('/parcels/:id', verifyFBToken, async (req, res) => {
            try {
                const id = req.params.id;

                const parcel = await parcelsCollection.findOne({
                    _id: new ObjectId(id)
                });

                if (!parcel) {
                    return res.status(404).json({ message: "Parcel not found" });
                }

                res.send(parcel)
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

        app.get("/riders/pending", async (req, res) => {
            try {
                const query = { status: "pending" };

                const pendingRiders = await ridersCollection
                    .find(query)
                    .sort({ appliedAt: -1 }) // latest first
                    .toArray();

                res.status(200).json(pendingRiders);
            } catch (error) {
                console.error("Error fetching pending riders:", error);
                res.status(500).json({
                    message: "Failed to load pending riders",
                });
            }
        });


        app.post('/riders', async (req, res) => {
            try {
                const riderData = req.body;
                const result = await ridersCollection.insertOne(riderData);
                res.status(201).send(result)
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });


        app.patch("/riders/:id/status", async (req, res) => {
            const { id } = req.params;
            const { status } = req.body;

            try {
                const result = await ridersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            status,
                            reviewedAt: new Date()
                        }
                    }
                );

                res.send(result);

            } catch (error) {
                console.error("Rider status update error:", error);
                res.status(500).json({
                    message: "Failed to update rider status"
                });
            }
        });

        app.post("/tracking", async (req, res) => {
            try {
                const { parcelId, trackingNumber, status, location, message, updatedBy } = req.body;

                if (!parcelId || !trackingNumber || !status) {
                    return res.status(400).json({ message: "parcelId, trackingNumber, and status are required" });
                }

                const result = await trackingCollection.insertOne({
                    parcelId: new ObjectId(parcelId),
                    trackingNumber,
                    status,
                    updatedBy: updatedBy || "system",
                    location: location || "",
                    message: message || "",
                    timestamp: new Date()
                });

                res.status(201).json({ message: "Tracking update added", insertedId: result.insertedId });
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to add tracking update", error: err.message });
            }
        });

        app.get("/tracking/:trackingNumber", async (req, res) => {
            try {
                const { trackingNumber } = req.params;

                const updates = await trackingCollection
                    .find({ trackingNumber })
                    .sort({ timestamp: -1 }) // latest first
                    .toArray();

                if (!updates.length) {
                    return res.status(404).json({ message: "No tracking updates found" });
                }

                res.status(200).json(updates);
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to fetch tracking updates", error: err.message });
            }
        });


        app.get("/payments", verifyFBToken, async (req, res) => {
            try {
                const { email } = req.query;

                if (req.decoded.email !== email) {
                    return res.status(403).json({ message: "forbidden access" });
                }

                // if email exists → user payments
                // if not → admin (all payments)
                const query = email ? { userEmail: email } : {};

                const payments = await paymentsCollection
                    .find(query)
                    .sort({ paidAt: -1 }) // latest first
                    .toArray();

                res.status(200).json(payments);
            } catch (error) {
                res.status(500).json({
                    message: "Failed to load payment history",
                    error: error.message
                });
            }
        });


        app.post("/payments", async (req, res) => {
            try {
                const paymentData = req.body;

                /*
                  Expected body:
                  {
                    parcelId,
                    senderEmail,
                    amount,
                    transactionId
                  }
                */

                // 1️⃣ save payment history
                const paymentResult = await paymentsCollection.insertOne({
                    parcelId: new ObjectId(paymentData.parcelId),
                    userEmail: paymentData.senderEmail,
                    amount: paymentData.amount,
                    currency: "usd",
                    paymentMethod: paymentData.paymentMethod || "card",
                    transactionId: paymentData.transactionId,
                    status: "paid",
                    paidAtString: new Date().toISOString(),
                    paidAt: new Date()
                });

                // 2️⃣ update parcel payment status
                await parcelsCollection.updateOne(
                    { _id: new ObjectId(paymentData.parcelId) },
                    {
                        $set: {
                            paymentStatus: "paid",
                            // paidAt: new Date()
                        }
                    }
                );

                res.status(201).json({
                    message: "Payment saved and parcel marked as paid",
                    insertedId: paymentResult.insertedId
                });

            } catch (error) {
                console.error("Payment save error:", error);
                res.status(500).json({
                    message: "Failed to save payment",
                    error: error.message
                });
            }
        });


        app.post("/create-payment-intent", async (req, res) => {
            const amountInCents = req.body.amountInCents;
            try {
                if (!amountInCents) {
                    return res.status(400).json({ message: "Amount in cents is required" });
                }

                const amount = Math.round(amountInCents); // Stripe uses cents

                const paymentIntent = await stripe.paymentIntents.create({
                    amount,
                    currency: "usd",
                    payment_method_types: ["card"],
                });

                res.status(200).json({
                    clientSecret: paymentIntent.client_secret,
                });

            } catch (error) {
                console.error("Stripe error:", error);

                res.status(500).json({
                    message: "Failed to create payment intent",
                    error: error.message,
                });
            }
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