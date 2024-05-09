const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken')
const stripe = require('stripe')(process.env.PAYMENT_TEST_KEY);
const app = express()
require("dotenv").config();
const port = process.env.port || 5000;

app.use(cors())
app.use(express.json())


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = process.env.DB_URL;

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
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");

        const Menus = client.db("Bistro-Boss").collection("Foods");
        const CartCollection = client.db("Bistro-Boss").collection("Cartinfo");
        const UserCollection = client.db("Bistro-Boss").collection("users");
        const PaymentCollection = client.db("Bistro-Boss").collection("payments");

        const varifyToken = (req, res, next) => {
            // console.log('inside verify token', req.headers.authorization);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized access' })
                }
                req.decoded = decoded;
                next();
            })
        }


        app.post("/jwt", (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN, { expiresIn: '2h' })
            res.send({ token })
        })
        app.post("/user", async (req, res) => {
            const info = req.body;
            const useremail = info.email
            const query = { email: useremail }
            const existinguser = await UserCollection.findOne(query)
            if (existinguser) {
                res.send({ message: "user already exist" })
            } else {
                const result = await UserCollection.insertOne(info)
                res.send(result)
            }

        })
        app.delete("/user/admin/:id", async (req, res) => {
            const userid = req.params.id;
            const filter = { _id: new ObjectId(userid) }
            const result = await UserCollection.deleteOne(filter)
            res.send(result)
        })
        app.patch("/user/admin/:id", async (req, res) => {
            const userid = req.params.id;
            const filter = { _id: new ObjectId(userid) }
            const updateuserRole = {
                $set: {
                    role: "admin"
                }
            }
            const result = await UserCollection.updateOne(filter, updateuserRole)
            res.send(result)
        })
        //verify admin middleware
        const varifyAdmin = async (req, res, next) => {
            const email = req.decoded.email
            const query = { email: email }
            const user = await UserCollection.findOne(query)
            if (user?.role !== 'admin') {
                res.status(401).send({ message: 'unauthorized access' })
            }
            next()
        }
        app.get("/user/admin/:email", async (req, res) => {
            const email = req.params.email
            const query = { email: email }
            const user = await UserCollection.findOne(query)
            const result = { admin: user?.role === 'admin' }
            res.send(result)
        })
        app.get("/user", varifyToken, varifyAdmin, async (req, res) => {
            const result = await UserCollection.find().toArray()
            res.send(result)
        })

        app.get("/menus", async (req, res) => {
            const result = await Menus.find().toArray()
            res.send(result)
        })
        app.post("/menus", varifyToken, varifyAdmin, async (req, res) => {
            const menuinfo = req.body
            const result = await Menus.insertOne(menuinfo)
            res.send(result)
        })
        app.delete("/menus/:id", async (req, res) => {
            const menuid = req.params.id
            const query = { _id: new ObjectId(menuid) }
            const result = await Menus.deleteOne(query)
            res.send(result)
        })

        app.post("/addcart", async (req, res) => {
            const info = req.body;
            const result = await CartCollection.insertOne(info)
            res.send(result)
        })

        app.get("/cart", async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([])
            }
            // const decodedEmail = req.decoded.email
            // if (email !== decodedEmail) {
            //     res.status(401).send({ message: 'unauthorized access' })
            // }
            const query = { Useremail: email }
            const result = await CartCollection.find(query).toArray()
            res.send(result)


        })

        app.delete("/cart/:id", async (req, res) => {
            const foodid = req.params.id;
            const query = { _id: new ObjectId(foodid) }
            const result = await CartCollection.deleteOne(query)
            res.send(result)
        })

        app.post("/create-payment-intent", varifyToken, async (req, res) => {
            const { price } = req.body
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
                // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
                // automatic_payment_methods: {
                //     enabled: true,
                // },
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        app.post("/payment", varifyToken, async (req, res) => {
            const { payment } = req.body
            const result = await PaymentCollection.insertOne(payment)
            const query = {
                _id: { $in: payment.Cartitems.map(id => new ObjectId(id)) }
            }
            const deleteresult = await CartCollection.deleteMany(query)
            res.send({ result, deleteresult })
        })
        app.get("/payment", varifyToken, async (req, res) => {
            const useremail = req.query.email
            const query = { email: useremail }
            const result = await PaymentCollection.find(query).toArray()
            res.send(result)
        })
        app.get("/admin-stats", varifyToken, varifyAdmin, async (req, res) => {
            const alluser = await UserCollection.estimatedDocumentCount()
            const orders = await PaymentCollection.estimatedDocumentCount()
            const foodtems = await Menus.estimatedDocumentCount()
            const payment = await PaymentCollection.find().toArray()
            const revenue = payment.reduce((sum, item) => sum + item.price, 0)
            res.send({ alluser, orders, foodtems, revenue })
        })

        app.get('/order-stats', async (req, res) => {
            const result = await PaymentCollection.aggregate([

                {
                    $lookup: {
                        from: 'Foods',
                        localField: 'Menuitems',
                        foreignField: '_id',
                        as: 'menuItemsID'
                    }
                }

            ]).toArray();

            res.send(result);

        })


    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get("/", (req, res) => {
    res.send("its running")
})

app.listen(port, () => {
    console.log(`App is runing on port ${port}`)
})
