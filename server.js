const express = require('express');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
const { pool, initializeDatabase } = require('./database');
const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors({
  origin: ['https://meeting.arkagme.biz','http://localhost:5173'] 
}));
app.use(express.json());

initializeDatabase();


app.get('/', (req, res) => {
  res.send('Meeting Room Booking API');
});

//Login endpoint
app.post('/api/auth/login', [
  body('name').notEmpty().trim(),
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email } = req.body;
    let userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      userResult = await pool.query(
        'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
        [name, email]
      );
      console.log('New user created')
    } else {
      if (userResult.rows[0].name !== name) {
        userResult = await pool.query(
          'UPDATE users SET name = $1 WHERE email = $2 RETURNING *',
          [name, email]
        );
      }
    console.log('User Fetched')
    }

    const user = userResult.rows[0];
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// get all rooms endpoint
app.get('/api/rooms', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rooms ORDER BY name');
    console.log('Rooms fetched')
    res.json(result.rows);
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


//get room availability by id and date endpoint
app.get('/api/rooms/:roomId/availability', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    const result = await pool.query(`
      SELECT b.*, u.name as user_name, u.email as user_email
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      WHERE b.room_id = $1 
      AND DATE(b.start_time) = $2
      ORDER BY b.start_time
    `, [roomId, date]);

    res.json(result.rows);
  } catch (error) {
    console.error('Get availability of rooms error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



//booking endpoint
app.post('/api/bookings', [
  body('userId').isInt(),
  body('roomId').isInt(),
  body('meetingTitle').notEmpty().trim(),
  body('startTime').isISO8601(),
  body('endTime').isISO8601(),
  body('attendeesCount').isInt({ min: 1 }),
  body('selectedEquipment').isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { userId, roomId, meetingTitle, startTime, endTime, attendeesCount, selectedEquipment } = req.body;
    const start = new Date(startTime);
    const end = new Date(endTime);
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bookingDate = new Date(start);
    bookingDate.setHours(0, 0, 0, 0);
    if (bookingDate.getTime() !== today.getTime()) {
      return res.status(400).json({ error: 'Bookings are only allowed for today' });
    }
    if (start <= now) {
      return res.status(400).json({ error: 'Cannot book for past time slots' });
    }
    if (end <= start) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }
    const startHour = start.getHours();
    const endHour = end.getHours();
    const endMinutes = end.getMinutes();
    if (startHour < 9 || (endHour > 22) || (endHour === 22 && endMinutes > 0)) {
      return res.status(400).json({ error: 'Bookings are only allowed between 9 AM and 10 PM' });
    }
    const duration = (end - start) / (1000 * 60);
    if (duration < 30) {
      return res.status(400).json({ error: 'Minimum booking duration is 30 minutes' });
    }
    if (duration > 300) {
      return res.status(400).json({ error: 'Maximum booking duration is 5 hours' });
    }

    const conflictResult = await pool.query(`
      SELECT * FROM bookings 
      WHERE room_id = $1 
      AND (
        (start_time <= $2 AND end_time > $2) OR
        (start_time < $3 AND end_time >= $3) OR
        (start_time >= $2 AND end_time <= $3)
      )
    `, [roomId, startTime, endTime]);
    if (conflictResult.rows.length > 0) {
      return res.status(409).json({ error: 'Time slot conflicts with existing booking' });
    }
    const result = await pool.query(`
      INSERT INTO bookings (user_id, room_id, meeting_title, start_time, end_time, attendees_count, selected_equipment)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [userId, roomId, meetingTitle, startTime, endTime, attendeesCount, selectedEquipment]);
    res.status(201).json({ success: true, booking: result.rows[0] });
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// get booking by user endpoint
app.get('/api/users/:userId/bookings', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(`
      SELECT b.*, r.name as room_name
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.user_id = $1
      ORDER BY b.start_time DESC
    `, [userId]);

    if( result.rows.length > 0) {
      console.log('User bookings fetched')
      res.json({ bookings: result.rows});
    }
    else{
        console.log('No bookings found for user')
        res.json({bookings: []});
    }
  } catch (error) {
    console.error('Get user bookings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// delete booking endpoint ( only by user )
app.delete('/api/bookings/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { userId } = req.body;

    const bookingResult = await pool.query(
      'SELECT * FROM bookings WHERE id = $1 AND user_id = $2',
      [bookingId, userId]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found or not authorized to cancel' });
    }

    await pool.query('DELETE FROM bookings WHERE id = $1', [bookingId]);

    res.json({ success: true, message: 'Booking cancelled successfully' });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// get all bookings for today endpoint
app.get('/api/bookings/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const result = await pool.query(`
      SELECT b.*, r.name as room_name, u.name as user_name
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      JOIN users u ON b.user_id = u.id
      WHERE DATE(b.start_time) = $1
      ORDER BY b.room_id, b.start_time
    `, [today]);

    res.json(result.rows);
  } catch (error) {
    console.error('Get today bookings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});