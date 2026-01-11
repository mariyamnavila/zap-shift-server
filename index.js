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

const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decodedKey);

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
        // await client.connect();

        const db = client.db("zapShiftParcels");
        const usersCollection = db.collection("users");
        const parcelsCollection = db.collection("parcels");
        const paymentsCollection = db.collection("payments");
        const ridersCollection = db.collection("riders");
        const trackingsCollection = db.collection("tracking");

        // custom middleware
        const verifyFBToken = async (req, res, next) => {
            // Implement Firebase token verification logic here
            const authHeader = req.headers.authorization;
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

        // Middleware to check if user is admin
        const verifyAdmin = async (req, res, next) => {
            try {
                const email = req.decoded.email; // from verifyFBToken middleware

                const user = await usersCollection.findOne({ email: email });

                if (!user || user.role !== 'admin') {
                    return res.status(403).json({ message: 'Access denied. Admin only.' });
                }

                req.user = user; // attach user to request
                next();
            } catch (error) {
                res.status(500).json({ message: 'Server error', error: error.message });
            }
        };

        // Middleware to check if user is rider
        const verifyRider = async (req, res, next) => {
            try {
                const email = req.decoded.email; // from verifyFBToken middleware

                const user = await usersCollection.findOne({ email: email });

                if (!user || user.role !== 'rider') {
                    return res.status(403).json({ message: 'Access denied. Rider only.' });
                }

                req.user = user; // attach user to request
                next();
            } catch (error) {
                res.status(500).json({ message: 'Server error', error: error.message });
            }
        };

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


        // Search users by email or name
        app.get('/users/search', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { query } = req.query;

                if (!query || query.trim() === '') {
                    return res.status(400).json({
                        success: false,
                        message: 'Search query is required'
                    });
                }

                // Search by email or name (case-insensitive)
                const users = await usersCollection.find({
                    $or: [
                        { email: { $regex: query, $options: 'i' } },
                        { name: { $regex: query, $options: 'i' } }
                    ]
                })
                    // .project({
                    //     _id: 1,
                    //     email: 1,
                    //     name: 1,
                    //     role: 1,
                    //     createdAt: 1,
                    //     lastLogIn: 1
                    // })
                    .limit(20) // Limit results to prevent overload
                    .sort({ createdAt: -1 })
                    .toArray();

                res.status(200).json({
                    success: true,
                    count: users.length,
                    users
                });
            } catch (error) {
                console.error('User search error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error searching users',
                    error: error.message
                });
            }
        });

        app.get("/users/:email/role", async (req, res) => {
            const email = req.params.email;

            if (!email) {
                return res.status(400).json({ message: "Email is required" });
            }

            try {
                const user = await usersCollection.findOne(
                    { email },
                    { projection: { role: 1 } }
                );

                // Fallback for first-time / social login users
                if (!user) {
                    return res.status(200).json({ role: "user" });
                }

                res.status(200).json({ role: user.role });

            } catch (error) {
                console.error("Get role error:", error);
                res.status(500).json({
                    message: "Failed to get user role",
                    error: error.message
                });
            }
        });


        // Update user role (make admin or remove admin)
        // /users/${userId}/role
        app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { id } = req.params;
                const { role } = req.body; // Expected: 'admin' or 'user'

                // Validate role
                if (!role || !['admin', 'user', 'rider'].includes(role)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid role. Must be "admin", "user", or "rider"'
                    });
                }

                // Update the role
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            role: role,
                            roleUpdatedAt: new Date()
                        }
                    }
                );

                res.send(result);
            } catch (error) {
                console.error('Update role error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error updating user role',
                    error: error.message
                });
            }
        });

        // Get admin statistics (optional but useful)
        app.get('/admin/stats', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const totalUsers = await usersCollection.countDocuments();
                const totalAdmins = await usersCollection.countDocuments({ role: 'admin' });
                const totalRiders = await usersCollection.countDocuments({ role: 'rider' });

                // Users created in last 7 days
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

                const recentUsers = await usersCollection.countDocuments({
                    createdAt: { $gte: sevenDaysAgo }
                });

                res.status(200).json({
                    success: true,
                    stats: {
                        totalUsers,
                        totalAdmins,
                        totalRiders,
                        recentUsers,
                        regularUsers: totalUsers - totalAdmins - totalRiders
                    }
                });
            } catch (error) {
                console.error('Stats fetch error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Error fetching statistics',
                    error: error.message
                });
            }
        });

        // Get parcels by user email using query parameter, sorted by latest first
        // Get all parcels OR parcels by user email (latest first)
        app.get('/parcels', verifyFBToken, async (req, res) => {
            try {
                const { email, paymentStatus, deliveryStatus } = req.query;

                let query = {};

                if (email) {
                    query = { userEmail: email };
                }

                if (paymentStatus) {
                    query.paymentStatus = paymentStatus;
                }

                if (deliveryStatus) {
                    query.deliveryStatus = deliveryStatus;
                }

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

        app.get("/parcels/delivery/status-count", async (req, res) => {
            try {

                const pipeline = [
                    {
                        $group: {
                            _id: "$deliveryStatus",
                            count: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            status: "$_id",
                            count: 1
                        }
                    },
                    {
                        $sort: { status: 1 }
                    }
                ];

                const result = await parcelsCollection.aggregate(pipeline).toArray();

                res.status(200).json(result);
            } catch (error) {
                console.error("Error counting parcels by status:", error);
                res.status(500).json({
                    message: "Failed to load parcel status counts",
                    error: error.message
                });
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

        app.patch('/parcels/:parcelId/assign-rider', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { parcelId } = req.params;
                const { riderId, riderName, riderEmail } = req.body;

                if (!riderId) {
                    return res.status(400).json({
                        success: false,
                        message: 'Rider ID is required'
                    });
                }

                const parcelObjectId = new ObjectId(parcelId);
                const riderObjectId = { _id: new ObjectId(riderId) };

                console.log(riderId);

                // 1️⃣ Check rider availability
                const rider = await ridersCollection.findOne(riderObjectId,
                    { status: 'active' });

                if (!rider) {
                    return res.status(404).json({
                        success: false,
                        message: 'Rider not found or not eligible'
                    });
                }

                if (rider.workStatus === 'in-delivery') {
                    return res.status(400).json({
                        success: false,
                        message: 'Rider is already in delivery'
                    });
                }

                // 2️⃣ Update Parcel
                const parcelUpdate = await parcelsCollection.updateOne(
                    {
                        _id: parcelObjectId,
                        deliveryStatus: 'not-collected'
                    },
                    {
                        $set: {
                            deliveryStatus: 'rider-assigned',
                            assignedRiderId: riderObjectId,
                            assignedRiderName: riderName || rider.name,
                            assignedRiderEmail: riderEmail || rider.email,
                            assignedAt: new Date()
                        }
                    }
                );

                if (parcelUpdate.modifiedCount === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Parcel not available for assignment'
                    });
                }

                // 3️⃣ Update Rider work status
                const riderUpdate = await ridersCollection.updateOne(
                    { _id: riderObjectId },
                    {
                        $set: {
                            workStatus: 'in-delivery',
                            lastAssignedAt: new Date()
                        }
                    }
                );

                res.status(200).json(riderUpdate);

            } catch (error) {
                console.error('Assign rider error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Failed to assign rider',
                    error: error.message
                });
            }
        }
        );

        app.patch('/parcels/:parcelId/status', verifyFBToken, async (req, res) => {
            try {
                const { parcelId } = req.params;
                const { deliveryStatus } = req.body;

                const parcelObjectId = new ObjectId(parcelId);

                // Fetch parcel
                const parcel = await parcelsCollection.findOne({
                    _id: parcelObjectId
                });

                if (!parcel) {
                    return res.status(404).json({
                        success: false,
                        message: 'Parcel not found'
                    });
                }

                // Update parcel status
                const updateDoc = {
                    deliveryStatus,
                };

                if (deliveryStatus === 'in-transit') {
                    updateDoc.pickedUpAt = new Date();
                }

                if (deliveryStatus === 'delivered') {
                    updateDoc.deliveredAt = new Date();
                }

                const result = await parcelsCollection.updateOne(
                    { _id: parcelObjectId },
                    { $set: updateDoc }
                );

                // If delivered → set rider workStatus back to idle
                if (deliveryStatus === 'delivered' && parcel.assignedRiderId) {
                    await ridersCollection.updateOne(
                        { _id: new ObjectId(parcel.assignedRiderId) },
                        {
                            $set: {
                                // workStatus: 'idle',
                                lastDeliveryCompletedAt: new Date()
                            }
                        }
                    );
                }

                res.status(200).json(result);

            } catch (error) {
                console.error('Update parcel status error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Failed to update parcel status',
                    error: error.message
                });
            }
        }
        );

        app.patch("/parcels/:id/cashOut", verifyFBToken, async (req, res) => {
            try {
                const { id } = req.params;

                const parcel = await parcelsCollection.findOne({
                    _id: new ObjectId(id)
                });

                // ✅ Must be delivered
                if (parcel.deliveryStatus !== "delivered") {
                    return res.status(400).json({
                        success: false,
                        message: "Parcel is not delivered yet"
                    });
                }

                // 🚫 Prevent double cash-out
                if (parcel.cashOutStatus === "paid") {
                    return res.status(400).json({
                        success: false,
                        message: "Cash-out already completed"
                    });
                }

                // 💰 Calculate earning
                const isSameDistrict =
                    parcel.senderDistrict === parcel.receiverDistrict;

                const earningRate = isSameDistrict ? 0.8 : 0.3;
                const riderEarning = Math.round(parcel.cost * earningRate);

                // 💾 Update parcel
                const result = await parcelsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            cashOutStatus: "paid",
                            cashOutAt: new Date(),
                            riderEarning
                        }
                    }
                );

                res.status(200).json(result);

            } catch (error) {
                console.error("Cash-out error:", error);
                res.status(500).json({
                    success: false,
                    message: "Internal server error"
                });
            }
        }
        );

        app.delete('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const result = await parcelsCollection.deleteOne({
                _id: new ObjectId(id)
            });
            res.send(result);
        });

        app.get('/riders', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { district } = req.query;

                // if (!district) {
                //     return res.status(400).json({
                //         success: false,
                //         message: 'District query parameter is required'
                //     });
                // }

                const query = {
                    district: district,
                    // status: 'active',
                };

                const riders = await ridersCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .toArray();

                res.status(200).json(riders);
            } catch (error) {
                console.error('Get riders error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Failed to load riders',
                    error: error.message
                });
            }
        });


        app.get("/riders/pending", verifyFBToken, verifyAdmin, async (req, res) => {
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

        // Get active riders
        app.get("/riders/active", verifyFBToken, verifyAdmin, async (req, res) => {
            const riders = await ridersCollection
                .find({ status: "active" })
                .sort({ appliedAt: -1 })
                .toArray();

            res.send(riders);
        });

        // Get pending parcels for a specific rider
        app.get("/riders/:email/pending-parcels", verifyFBToken, verifyRider, async (req, res) => {
            try {
                const riderEmail = req.params.email;

                if (!riderEmail) {
                    return res.status(400).json({ message: "Rider email is required" });
                }

                const pendingParcels = await parcelsCollection
                    .find({
                        assignedRiderEmail: riderEmail,
                        deliveryStatus: {
                            $in: ["rider-assigned", "in-transit"]
                        }
                    })
                    .sort({ assignedAt: -1 }) // latest task first
                    .toArray();

                res.status(200).json(pendingParcels);
            } catch (error) {
                console.error("Error loading rider parcels:", error);
                res.status(500).json({
                    message: "Failed to load rider pending parcels",
                    error: error.message
                });
            }
        });

        // Get completed parcels for a specific rider
        app.get("/riders/:email/completed-parcels", verifyFBToken, verifyRider, async (req, res) => {
            try {
                const riderEmail = req.params.email;

                if (!riderEmail) {
                    return res.status(400).json({ message: "Rider email is required" });
                }

                const completedParcels = await parcelsCollection
                    .find({
                        assignedRiderEmail: riderEmail,
                        deliveryStatus: {
                            $in: ["delivered", "service-center-delivered"]
                        }
                    })
                    .sort({ deliveredAt: -1, assignedAt: -1 }) // latest first
                    .toArray();

                res.status(200).json(completedParcels);
            } catch (error) {
                console.error("Error loading completed parcels:", error);
                res.status(500).json({
                    message: "Failed to load completed deliveries",
                    error: error.message
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

        // WHY: Using PATCH instead of PUT because we only update status

        app.patch("/riders/:id/status", async (req, res) => {
            const { id } = req.params;
            const { status, email } = req.body;

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

                // If approved, also update users collection to set role to 'rider'
                if (status === "active" && email) {
                    const userQuery = { email: email };
                    const userUpdatedDoc = {
                        $set:
                        {
                            role: "rider"
                        }
                    }
                    const roleResult = await usersCollection.updateOne(userQuery, userUpdatedDoc);
                    console.log(roleResult);
                }

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

                const result = await trackingsCollection.insertOne({
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

                const updates = await trackingsCollection
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
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
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