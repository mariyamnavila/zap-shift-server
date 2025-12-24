// index.js
const express = require('express');
const cors = require('cors');
const Stripe = require("stripe");

require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

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
        const parcelsCollection = db.collection("parcels");
        const paymentsCollection = db.collection("payments");

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


        app.get('/parcels/:id', async (req, res) => {
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

        app.get("/payments", async (req, res) => {
            try {
                const { email } = req.query;

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