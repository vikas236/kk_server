import express from "express";
import pkg from "pg";
const { Client, Pool } = pkg;
import dotenv from "dotenv";

const app = express();
const port = 3000;
dotenv.config();
app.use(express.json());

// Use Pool instead of Client for better connection management
const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  port: 5432, // Default PostgreSQL port
  ssl: { rejectUnauthorized: false }, // Required if using Neon database
});

app.get("/", (req, res) => {
  res.send("Welcome to my server!");
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

app.get("/categories", async (req, res) => {
  try {
    const query = "SELECT * FROM categories";
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error("Error: ", err);
    res.status(500).send({ message: "Error fetching restaurants" });
  }
});

app.post("/get_dishes", async (req, res) => {
  const { restaurant, category } = req.body;

  const restaurant_id = await pool.query(
    "select id from restaurants where name = $1",
    [restaurant]
  );

  const category_id = await pool.query(
    "select id from categories where name = $1",
    [category]
  );

  const dishes = await pool.query(
    "select * from restaurant_category_dish where restaurant_id = $1 and category_id = $2",
    [restaurant_id.rows[0].id, category_id.rows[0].id]
  );

  res.json({
    dishes: dishes.rows,
  });
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

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
