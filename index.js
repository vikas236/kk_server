import express from "express";
import pkg from "pg";
const { Client, Pool } = pkg;
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";

const app = express();
const port = 3000;
dotenv.config();
app.use(express.json());
// Increase limit (default is 100kb)
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// Use Pool instead of Client for better connection management
const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  port: 5432, // Default PostgreSQL port
  ssl: { rejectUnauthorized: false }, // Required if using Neon database
});

const corsOptions = {
  origin: ["http://localhost:5173", "https://www.konaseemakart.in"],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

app.get("/", (req, res) => {
  res.send("Welcome to my server!");
});

app.post("/get_table", async (req, res) => {
  try {
    const { table_name } = req.body;

    if (!table_name) {
      return res.status(400).json({ message: "Table name is required" });
    }

    const query = `SELECT * FROM ${table_name}`;
    const result = await pool.query(query);

    res.status(201).json(result.rows);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ message: "Error getting table contents" });
  }
});

app.get("/restaurants", async (req, res) => {
  try {
    const query = "SELECT * FROM restaurants";
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error("Error: ", err);
    res.status(500).send({ message: "Error fetching restaurants" });
  }
});

app.post("/add_restaurant", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }

    const query = "INSERT INTO restaurants (name) VALUES ($1) RETURNING *";
    const result = await pool.query(query, [name]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ message: "Error adding restaurant" });
  }
});

app.post("/remove_restaurant", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Restaurant name is required" });
    }

    const query = "DELETE FROM restaurants WHERE name = $1 RETURNING *";
    const result = await pool.query(query, [name]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    res.status(200).json({
      message: "Restaurant removed successfully",
      deleted: result.rows[0],
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ message: "Error removing restaurant" });
  }
});

app.post("/categories", async (req, res) => {
  const { restaurant_name } = req.body;

  try {
    const query = `SELECT DISTINCT c.id, c.name 
      FROM restaurant_categories rc
      JOIN categories c ON rc.category_id = c.id
      JOIN restaurants r ON rc.restaurant_id = r.id
      WHERE r.name = $1;
    `;

    const result = await pool.query(query, [restaurant_name]);
    const categories = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
    }));
    res.json(categories);
  } catch (err) {
    console.error("Error: ", err);
    res.status(500).send({ message: "Error fetching restaurants" });
  }
});

app.post("/add_category", async (req, res) => {
  try {
    const { name, restaurant_name } = req.body;

    if (!name || !restaurant_name) {
      return res
        .status(400)
        .json({ message: "Name and Restaurant Name are required" });
    }

    // 1️⃣ Get restaurant ID from name
    const restaurantResult = await pool.query(
      "SELECT id FROM restaurants WHERE name = $1",
      [restaurant_name]
    );

    if (restaurantResult.rows.length === 0) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    const restaurant_id = restaurantResult.rows[0].id;

    // 2️⃣ Insert category (if not exists)
    const categoryQuery =
      "INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *";
    let categoryResult = await pool.query(categoryQuery, [name]);

    // If category already exists, fetch its ID
    if (categoryResult.rows.length === 0) {
      const existingCategoryQuery = "SELECT id FROM categories WHERE name = $1";
      categoryResult = await pool.query(existingCategoryQuery, [name]);
    }

    const category_id = categoryResult.rows[0].id;

    // 3️⃣ Insert into restaurant_categories (if not exists)
    const insertRestaurantCategoryQuery = `
      INSERT INTO restaurant_categories (restaurant_id, category_id) 
      VALUES ($1, $2) 
      ON CONFLICT (restaurant_id, category_id) DO NOTHING;
    `;
    await pool.query(insertRestaurantCategoryQuery, [
      restaurant_id,
      category_id,
    ]);

    res.status(201).json({
      message: "Category added and linked to restaurant",
      restaurant_id,
      category_id,
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ message: "Error adding category" });
  }
});

app.post("/remove_category", async (req, res) => {
  try {
    const { name, restaurant_name } = req.body;

    if (!name || !restaurant_name) {
      return res
        .status(400)
        .json({ message: "Category Name and Restaurant Name are required" });
    }

    const client = await pool.connect(); // Get DB connection
    try {
      await client.query("BEGIN"); // Start transaction

      // 1️⃣ Get restaurant ID
      const restaurantResult = await client.query(
        "SELECT id FROM restaurants WHERE name = $1",
        [restaurant_name]
      );

      if (restaurantResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Restaurant not found" });
      }

      const restaurant_id = restaurantResult.rows[0].id;

      // 2️⃣ Get category ID
      const categoryResult = await client.query(
        "SELECT id FROM categories WHERE name = $1",
        [name]
      );

      if (categoryResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Category not found" });
      }

      const category_id = categoryResult.rows[0].id;

      // 3️⃣ Remove from restaurant_categories
      const deleteCategoryFromRestaurant = await client.query(
        "DELETE FROM restaurant_categories WHERE restaurant_id = $1 AND category_id = $2 RETURNING *",
        [restaurant_id, category_id]
      );

      if (deleteCategoryFromRestaurant.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "Category not linked to this restaurant",
        });
      }

      // 4️⃣ Check if category is still used in other restaurants
      const categoryUsageCheck = await client.query(
        "SELECT 1 FROM restaurant_categories WHERE category_id = $1 LIMIT 1",
        [category_id]
      );

      if (categoryUsageCheck.rows.length === 0) {
        // 5️⃣ Delete category if it's no longer used
        await client.query("DELETE FROM categories WHERE id = $1", [
          category_id,
        ]);
      }

      await client.query("COMMIT"); // Commit transaction

      res.status(200).json({
        message: "Category removed successfully",
        restaurant_id,
        category_id,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error:", error);
      res.status(500).json({ message: "Error removing category" });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ message: "Database connection error" });
  }
});

app.post("/get_dishes", async (req, res) => {
  try {
    const { restaurant, category } = req.body;

    if (!restaurant || !category) {
      return res
        .status(400)
        .json({ message: "Restaurant and category are required" });
    }

    // Get restaurant ID
    const restaurantResult = await pool.query(
      "SELECT id FROM restaurants WHERE name = $1",
      [restaurant]
    );
    if (restaurantResult.rows.length === 0) {
      return res.status(404).json({ message: "Restaurant not found" });
    }
    const restaurant_id = restaurantResult.rows[0].id;

    // Get category ID
    const categoryResult = await pool.query(
      "SELECT id FROM categories WHERE name = $1",
      [category]
    );
    if (categoryResult.rows.length === 0) {
      return res.status(404).json({ message: "Category not found" });
    }
    const category_id = categoryResult.rows[0].id;

    // Get dish details (including names)
    const dishesResult = await pool.query(
      `SELECT rcd.menu_item_id, mi.name AS dish_name, rcd.price, rcd.image FROM restaurant_category_dish rcd
      JOIN menu_items mi ON rcd.menu_item_id = mi.id WHERE rcd.restaurant_id = $1 AND rcd.category_id = $2;`,
      [restaurant_id, category_id]
    );

    res.json({ dishes: dishesResult.rows });
  } catch (error) {
    console.error("Error fetching dishes:", error);
    res.status(500).json({ message: "Error fetching dishes" });
  }
});

app.post("/search_dish", async (req, res) => {
  const { search_term } = req.body;

  try {
    const queries = {
      restaurants:
        "SELECT id, name, 'restaurants' AS table_name FROM restaurants WHERE name ~* $1",
      categories:
        "SELECT id, name, 'categories' AS table_name FROM categories WHERE name ~* $1",
      menu_items:
        "SELECT id, name, 'menu_items' AS table_name FROM menu_items WHERE name ~* $1",
    };

    const results = await Promise.all(
      Object.values(queries).map((query) => pool.query(query, [search_term]))
    );

    const finalResult = results
      .flatMap((res, i) => res.rows)
      .sort((a, b) => a.table_name.localeCompare(b.table_name) || a.id - b.id);

    console.log(finalResult);

    res.json(finalResult);
  } catch (err) {
    console.error("Error: ", err);
    res.status(500).send({ message: "Error fetching results" });
  }
});

app.post("/send-otp", async (req, res) => {
  const { phoneNumber } = req.body;

  if (!/^\d{10}$/.test(phoneNumber)) {
    res.status(400).send({ message: "Please enter a valid phone number" });
    return;
  }

  try {
    const otp = Math.floor(100000 + Math.random() * 900000);
    // Commenting out the actual OTP sending via Fast2SMS for testing purposes
    const response = await fetch(
      `${process.env.FAST2SMS_BASE_URL}?authorization=${process.env.FAST2SMS_AUTHORIZATION}&route=otp&variables_values=${otp}&flash=0&numbers=${phoneNumber}`
    );

    // Mocking a successful response for testing
    // const data = {
    //   status: "success",
    //   verification_id: "mock-verification-id",
    // };
    await storeOtp(phoneNumber, otp);

    if (data.status === "success") {
      res.json({
        message: "OTP sent successfully",
        verificationId: data.verification_id,
      });
    } else {
      res.status(500).send({ message: data.message });
    }
  } catch (error) {
    console.error("Error: ", error);
    res.status(500).send({ message: "Error sending OTP" });
  }
});

app.post("/verify-otp", async (req, res) => {
  const { phoneNumber, otp } = req.body;

  try {
    // Get stored OTP from database
    const storedOtp = await getOtp(phoneNumber);
    console.log(storedOtp);

    // Check if OTP exists
    if (!storedOtp) {
      return res.status(404).json({ message: "No OTP found for this number" });
    }

    // Compare submitted OTP with stored OTP
    if (storedOtp === otp) {
      await pool.query(
        "DELETE FROM kk_pending_logins WHERE phone = $1 AND otp = $2",
        [phoneNumber, otp]
      );

      return res.status(200).json({ message: "OTP verified successfully" });
    } else {
      return res.status(400).json({ message: "Incorrect OTP" });
    }
  } catch (error) {
    console.error("Error verifying OTP:", error);
    return res.status(500).json({ message: "Error verifying OTP" });
  }
});

app.post("/echo", async (req, res) => {
  res.json(req.body);
});

app.post("/add_dishimage", async (req, res) => {
  const { restaurant_name, category_name, dish_name, base64 } = req.body;

  try {
    // Query to find the correct row in restaurant_category_dish
    const dishQuery = `
      SELECT rcd.restaurant_id, r.name AS restaurant_name,
             rcd.category_id, c.name AS category_name,
             rcd.menu_item_id, mi.name AS menu_item_name,
             rcd.price, rcd.image
      FROM restaurant_category_dish rcd
      JOIN restaurants r ON rcd.restaurant_id = r.id
      JOIN categories c ON rcd.category_id = c.id
      JOIN menu_items mi ON rcd.menu_item_id = mi.id
      WHERE r.name ~* $1 
        AND c.name ~* $2 
        AND mi.name ~* $3;
    `;

    const dishResult = await pool.query(dishQuery, [
      restaurant_name,
      category_name,
      dish_name,
    ]);

    // If no matching row is found
    if (dishResult.rows.length === 0) {
      return res.status(404).json({ message: "No matching dish found" });
    }

    // Extract the restaurant_id, category_id, and menu_item_id
    const { restaurant_id, category_id, menu_item_id } = dishResult.rows[0];

    // Update query to set the image column
    const updateQuery = `
      UPDATE restaurant_category_dish
      SET image = $4
      WHERE restaurant_id = $1 AND category_id = $2 AND menu_item_id = $3
      RETURNING *;
    `;

    const updateResult = await pool.query(updateQuery, [
      restaurant_id,
      category_id,
      menu_item_id,
      base64,
    ]);

    res.json({ message: "image added successfully" });
  } catch (err) {
    console.error("Error: ", err);
    res.status(500).send({ message: "Error updating image" });
  }
});

app.post("/remove_dishimage", async (req, res) => {
  const { restaurant_name, category_name, dish_name } = req.body;

  try {
    // Query to find the correct row in restaurant_category_dish
    const dishQuery = `
      SELECT rcd.restaurant_id, rcd.category_id, rcd.menu_item_id
      FROM restaurant_category_dish rcd
      JOIN restaurants r ON rcd.restaurant_id = r.id
      JOIN categories c ON rcd.category_id = c.id
      JOIN menu_items mi ON rcd.menu_item_id = mi.id
      WHERE r.name ~* $1 
        AND c.name ~* $2 
        AND mi.name ~* $3;
    `;

    const dishResult = await pool.query(dishQuery, [
      restaurant_name,
      category_name,
      dish_name,
    ]);

    // If no matching row is found
    if (dishResult.rows.length === 0) {
      return res.status(404).json({ message: "No matching dish found" });
    }

    // Extract the restaurant_id, category_id, and menu_item_id
    const { restaurant_id, category_id, menu_item_id } = dishResult.rows[0];

    // Update query to remove the image (set it to NULL)
    const updateQuery = `
      UPDATE restaurant_category_dish
      SET image = NULL
      WHERE restaurant_id = $1 AND category_id = $2 AND menu_item_id = $3
      RETURNING *;
    `;

    await pool.query(updateQuery, [restaurant_id, category_id, menu_item_id]);

    res.json({ message: "Image removed successfully" });
  } catch (err) {
    console.error("Error: ", err);
    res.status(500).send({ message: "Error removing image" });
  }
});

app.post("/update_dishprice", async (req, res) => {
  const { restaurant_name, category_name, dish_name, new_price } = req.body;

  try {
    // Query to find the correct row in restaurant_category_dish
    const dishQuery = `
      SELECT rcd.restaurant_id, rcd.category_id, rcd.menu_item_id
      FROM restaurant_category_dish rcd
      JOIN restaurants r ON rcd.restaurant_id = r.id
      JOIN categories c ON rcd.category_id = c.id
      JOIN menu_items mi ON rcd.menu_item_id = mi.id
      WHERE r.name ~* $1 
        AND c.name ~* $2 
        AND mi.name ~* $3;
    `;

    const dishResult = await pool.query(dishQuery, [
      restaurant_name,
      category_name,
      dish_name,
    ]);

    // If no matching row is found
    if (dishResult.rows.length === 0) {
      return res.status(404).json({ message: "No matching dish found" });
    }

    // Extract the restaurant_id, category_id, and menu_item_id
    const { restaurant_id, category_id, menu_item_id } = dishResult.rows[0];

    // Update query to change the price
    const updateQuery = `
      UPDATE restaurant_category_dish
      SET price = $4
      WHERE restaurant_id = $1 AND category_id = $2 AND menu_item_id = $3
      RETURNING *;
    `;

    const updateResult = await pool.query(updateQuery, [
      restaurant_id,
      category_id,
      menu_item_id,
      new_price,
    ]);

    res.json({
      message: "Price updated successfully",
      updatedDish: updateResult.rows[0],
    });
  } catch (err) {
    console.error("Error: ", err);
    res.status(500).send({ message: "Error updating price" });
  }
});

app.post("/add_new_dish", async (req, res) => {
  const { restaurant_name, category_name, dish_name } = req.body;
  if (!restaurant_name || !category_name || !dish_name)
    return res.status(400).json({ error: "Missing required fields" });

  try {
    // Find restaurant_id and category_id (do not create)
    const query = `
      SELECT r.id AS restaurant_id, c.id AS category_id
      FROM restaurants r, categories c
      WHERE r.name ILIKE $1 AND c.name ILIKE $2
    `;
    const result = await pool.query(query, [restaurant_name, category_name]);

    if (result.rows.length === 0) {
      pool.release();
      return res
        .status(404)
        .json({ error: "Restaurant or Category not found" });
    }

    const { restaurant_id, category_id } = result.rows[0];

    // Find or create menu_item_id
    let dishResult = await pool.query(
      "SELECT id FROM menu_items WHERE name ILIKE $1",
      [dish_name]
    );

    let menu_item_id;
    if (dishResult.rows.length > 0) {
      menu_item_id = dishResult.rows[0].id;
    } else {
      const insertDish = await pool.query(
        "INSERT INTO menu_items (name) VALUES ($1) RETURNING id",
        [dish_name]
      );
      menu_item_id = insertDish.rows[0].id;
    }

    // Insert into restaurant_category_dish (if not exists)
    const insertResult = await pool.query(
      `INSERT INTO restaurant_category_dish (restaurant_id, category_id, menu_item_id, price, image)
       VALUES ($1, $2, $3, 0, NULL)
       ON CONFLICT (restaurant_id, category_id, menu_item_id) DO NOTHING`,
      [restaurant_id, category_id, menu_item_id]
    );

    if (insertResult.rowCount === 0) {
      return res.status(201).json({
        message: "Dish already exists for this restaurant and category",
      });
    }

    res.status(201).json({ message: "Dish added successfully" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/remove_dish", async (req, res) => {
  const { restaurant_name, category_name, dish_name } = req.body;
  if (!restaurant_name || !category_name || !dish_name)
    return res.status(400).json({ error: "Missing required fields" });

  try {
    // Find restaurant_id, category_id, and menu_item_id
    const query = `
      SELECT r.id AS restaurant_id, c.id AS category_id, mi.id AS menu_item_id
      FROM restaurants r
      JOIN categories c ON c.name ILIKE $2
      JOIN menu_items mi ON mi.name ILIKE $3
      JOIN restaurant_category_dish rcd 
        ON rcd.restaurant_id = r.id 
        AND rcd.category_id = c.id 
        AND rcd.menu_item_id = mi.id
      WHERE r.name ILIKE $1
    `;
    const result = await pool.query(query, [
      restaurant_name,
      category_name,
      dish_name,
    ]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Dish not found in this restaurant and category" });
    }

    const { restaurant_id, category_id, menu_item_id } = result.rows[0];

    // Delete dish from restaurant_category_dish
    await pool.query(
      `DELETE FROM restaurant_category_dish
       WHERE restaurant_id = $1 AND category_id = $2 AND menu_item_id = $3`,
      [restaurant_id, category_id, menu_item_id]
    );

    // Check if the dish still exists in restaurant_category_dish
    const checkDish = await pool.query(
      "SELECT 1 FROM restaurant_category_dish WHERE menu_item_id = $1 LIMIT 1",
      [menu_item_id]
    );

    if (checkDish.rows.length === 0) {
      // Delete from menu_items if no references exist
      await pool.query("DELETE FROM menu_items WHERE id = $1", [menu_item_id]);
    }

    res.status(200).json({ message: "Dish removed successfully" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/add_new_order", async (req, res) => {
  try {
    const {
      name,
      restaurant_name,
      food_order_items,
      phone,
      address,
      location_url,
      total_amount,
    } = req.body;

    // Validate required fields
    if (
      !name ||
      !restaurant_name ||
      !food_order_items ||
      !phone ||
      !address ||
      !location_url ||
      !total_amount
    ) {
      return res.status(400).json({ error: "All fields are required!" });
    }

    // Insert into database
    const query = `
      INSERT INTO kk_orders (name, restaurant_name, food_order_items, phone, address, location_url, total_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;

    const values = [
      name,
      restaurant_name,
      food_order_items,
      phone,
      address,
      location_url,
      total_amount,
    ];
    const result = await pool.query(query, values);

    res.status(201).json({
      message: "Order placed successfully!",
      order: result.rows[0], // Return the created order
    });
  } catch (error) {
    console.error("❌ Error adding order:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/get_user_orders", async (req, res) => {
  try {
    const { phone } = req.body;

    // Validate phone number
    if (!phone) {
      return res.status(400).json({ error: "Phone number is required!" });
    }

    // Fetch orders with the given phone number (oldest first)
    const query = `SELECT * FROM kk_orders WHERE phone = $1 ORDER BY created_at DESC;`;
    const result = await pool.query(query, [phone]);

    res.status(200).json({ orders: result.rows });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/get_orders_by_date", async (req, res) => {
  try {
    const { date } = req.body;

    // Validate required field
    if (!date) {
      return res.status(400).json({ error: "Date is required!" });
    }

    // Fetch orders for the given date
    const query = `
      SELECT * FROM kk_orders
      WHERE DATE(created_at) = $1
      ORDER BY created_at ASC;
    `;

    const result = await pool.query(query, [date]);

    res.status(200).json({ orders: result.rows });
  } catch (error) {
    console.error("Error fetching orders by date:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/update_order_status", async (req, res) => {
  try {
    const {
      id,
      name,
      restaurant_name,
      food_order_items,
      phone,
      address,
      location_url,
      total_amount,
      order_status, // New field for updating status
    } = req.body;

    // Validate required fields
    if (
      !id ||
      !name ||
      !restaurant_name ||
      !food_order_items ||
      !phone ||
      !address ||
      !location_url ||
      !total_amount ||
      !order_status
    ) {
      return res.status(400).json({ error: "All fields are required!" });
    }

    // Update order status where all other fields match
    const query = `
      UPDATE kk_orders 
      SET order_status = $9
      WHERE id = $1 
      AND name = $2 
      AND restaurant_name = $3 
      AND food_order_items = $4 
      AND phone = $5 
      AND address = $6 
      AND location_url = $7 
      AND total_amount = $8 
      RETURNING *;
    `;

    const values = [
      id,
      name,
      restaurant_name,
      food_order_items,
      phone,
      address,
      location_url,
      total_amount,
      order_status,
    ];

    const result = await pool.query(query, values);
    console.log(result);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Order not found!" });
    }

    res.status(200).json({
      message: "Order status updated successfully!",
      updatedOrder: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const storeOtp = async (phoneNumber, otp) => {
  try {
    await pool.query(
      `INSERT INTO kk_pending_logins (phone, otp, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (phone) 
       DO UPDATE SET otp = $2, created_at = NOW();`,
      [phoneNumber, otp]
    );
    console.log(`OTP ${otp} stored for phone: ${phoneNumber}`);
  } catch (error) {
    console.error("Error storing OTP:", error);
    throw new Error("Database error while storing OTP");
  }
};

const getOtp = async (phoneNumber) => {
  try {
    const result = await pool.query(
      `SELECT otp FROM kk_pending_logins WHERE phone = $1;`,
      [phoneNumber]
    );

    if (result.rows.length > 0) {
      return result.rows[0].otp; // Return the OTP
    } else {
      return null; // No OTP found
    }
  } catch (error) {
    console.error("Error retrieving OTP:", error);
    throw new Error("Database error while fetching OTP");
  }
};

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
