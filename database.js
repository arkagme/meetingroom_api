const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        capacity INTEGER NOT NULL,
        equipment TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        room_id INTEGER REFERENCES rooms(id),
        meeting_title VARCHAR(255) NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        attendees_count INTEGER NOT NULL,
        selected_equipment TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    const roomsExist = await pool.query('SELECT COUNT(*) FROM rooms');
    if (parseInt(roomsExist.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO rooms (name, capacity, equipment) VALUES
        ('Conference Room A', 10, ARRAY['Projector', 'Whiteboard', 'Video Conference', 'Sound System']),
        ('Conference Room B', 8, ARRAY['Projector', 'Whiteboard', 'Video Conference']),
        ('Meeting Room C', 6, ARRAY['Whiteboard', 'TV Screen']),
        ('Board Room', 12, ARRAY['Projector', 'Whiteboard', 'Video Conference', 'Sound System', 'Phone'])
      `);
    }

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

module.exports = { pool, initializeDatabase };