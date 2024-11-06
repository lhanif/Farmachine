// server.js
const express = require('express');
const app = express();
const pool = require('./db');
const cors = require('cors');
const path = require('path');
const mqtt = require('mqtt');
const fs = require('fs');

const twilio = require('twilio');
const { v4: uuidv4 } = require('uuid');

const cloudinary = require('cloudinary').v2;

const accountSid = 'AC633024cf5cf9c4ee93941a19770d804a'; // Ganti dengan Account SID Anda
const authToken = '3bb4ea59a396cc1574812328549b5c6a'; // Ganti dengan Auth Token Anda
const client = new twilio(accountSid, authToken);


const mqttClient = mqtt.connect('mqtt://test.mosquitto.org');

cloudinary.config({
    cloud_name: 'djxtaxgxd',
    api_key: '633297166411815',
    api_secret: 'fCIV5WvsLObnVHuaRCAHDceeiuU'
});

app.use(cors());
app.use(express.json());

// Melayani file statis dari folder "public"
app.use(express.static(path.join(__dirname, 'public')));

const qrImagePath = path.join(__dirname, 'public', 'qr-images');
if (!fs.existsSync(qrImagePath)) {
    fs.mkdirSync(qrImagePath, { recursive: true });
}

// Cek koneksi database
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring client', err.stack);
    }
    console.log('Database connected successfully');
    release();
});

// MQTT - Subscribe ke topik "rak/+/status"
mqttClient.on('connect', () => {
    console.log('Connected to MQTT broker');
    mqttClient.subscribe('rak/+/status', (err) => {
        if (!err) {
            console.log('Subscribed to MQTT topic: rak/+/status');
        } else {
            console.error('Failed to subscribe to MQTT topic:', err);
        }
    });
});


// Handler untuk pesan MQTT
mqttClient.on('message', async (topic, message) => {
    const status = message.toString();
    const match = topic.match(/^rak\/(\d+)\/status$/);
    
    if (match && (status === 'empty' || status === 'ready')) {
        const rakId = parseInt(match[1]);

        try {
            const result = await pool.query(
                `UPDATE rak SET status = $1 WHERE nomor_rak = $2`,
                [status, rakId]
            );

            if (result.rowCount > 0) {
                console.log(`Rak ${rakId} status updated to ${status}`);
                mqttClient.publish('rak/ack', 'ack'); // Mengirimkan acknowledgment ke ESP32
            } else {
                console.log(`Rak ${rakId} not found`);
            }
        } catch (err) {
            console.error('Error updating rak status:', err.message);
        }
    } else {
        console.log(`Received invalid MQTT message: ${message}`);
    }
});

// Endpoint untuk mencari pasien berdasarkan NIK
app.get('/api/patient', async (req, res) => {
    const { nik } = req.query;
    try {
        const result = await pool.query('SELECT * FROM patients WHERE nik = $1', [nik]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ message: 'Patient not found' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Endpoint untuk menambahkan data pesanan dan menentukan rak
app.post('/api/addPesanan', async (req, res) => {
    const { nik, nama_pasien, no_rm, umur, jenis_kelamin, keterangan, obat } = req.body;

    // Log data yang diterima di server
    console.log("Data yang diterima dari klien:", req.body);

    try {
        // Mulai transaksi
        await pool.query('BEGIN');

        // Lanjutkan proses seperti sebelumnya
        const rakResult = await pool.query(
            `SELECT id FROM rak WHERE status = 'empty' ORDER BY nomor_rak ASC LIMIT 1`
        );

        if (rakResult.rows.length === 0) {
            res.status(400).json({ message: 'Tidak ada rak kosong yang tersedia' });
            await pool.query('ROLLBACK');
            return;
        }

        const rak_id = rakResult.rows[0].id;

        await pool.query(
            `UPDATE rak SET status = 'fill' WHERE id = $1`,
            [rak_id]
        );

        const pesananResult = await pool.query(
            `INSERT INTO pesanan (nik, nama_pasien, no_rm, umur, jenis_kelamin, keterangan, rak_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [nik, nama_pasien, no_rm, umur, jenis_kelamin, keterangan, rak_id]
        );

        const pesanan_id = pesananResult.rows[0].id;

        for (const item of obat) {
            const { nama_obat, jumlah, dosis } = item;
            await pool.query(
                `INSERT INTO obat_pesanan (pesanan_id, nama_obat, jumlah, dosis) 
                 VALUES ($1, $2, $3, $4)`,
                [pesanan_id, nama_obat, jumlah, dosis]
            );
        }

        await pool.query('COMMIT');
        
        res.status(200).json({ message: 'Pesanan berhasil disimpan', rak_id });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Error saving pesanan:', err.message);
        res.status(500).json({ message: 'Gagal menyimpan pesanan' });
    }
});



// Endpoint untuk mengambil status semua rak
// Endpoint untuk mengambil status semua rak dan nama pasien jika rak dalam status 'fill' atau 'ready'
app.get('/api/rakStatus', async (req, res) => {
  console.log('Endpoint /api/rakStatus diakses');
  try {
      const result = await pool.query(`
          SELECT r.nomor_rak, r.status, p.nama_pasien
          FROM rak r
          LEFT JOIN pesanan p ON r.id = p.rak_id AND r.status IN ('fill', 'ready')
          ORDER BY r.nomor_rak ASC
      `);

      res.json(result.rows);
  } catch (err) {
      console.error('Error fetching rak status:', err.message);
      res.status(500).json({ message: 'Gagal mengambil status rak' });
  }
});

// Endpoint untuk mengambil data pesanan terbaru berdasarkan rak_id
app.get('/api/pesananByRak', async (req, res) => {
  const { rak_id } = req.query;
  try {
      // Ambil data pasien berdasarkan rak_id dengan id pesanan terbesar (terbaru)
      const pesananResult = await pool.query(`
          SELECT p.id AS pesanan_id, p.nama_pasien, p.no_rm, p.umur, p.jenis_kelamin, p.keterangan
          FROM pesanan p
          WHERE p.rak_id = $1
          ORDER BY p.id DESC
          LIMIT 1
      `, [rak_id]);

      if (pesananResult.rows.length === 0) {
          return res.status(404).json({ message: 'Pesanan tidak ditemukan untuk rak ini' });
      }

      const pesanan_id = pesananResult.rows[0].pesanan_id;

      // Ambil data obat berdasarkan pesanan_id terbaru
      const obatResult = await pool.query(`
          SELECT nama_obat, jumlah, dosis
          FROM obat_pesanan
          WHERE pesanan_id = $1
      `, [pesanan_id]);

      res.json({
          pasien: pesananResult.rows[0],
          obat: obatResult.rows
      });
  } catch (err) {
      console.error('Error fetching pesanan by rak:', err.message);
      res.status(500).json({ message: 'Gagal mengambil data pesanan' });
  }
});

// Endpoint untuk mengambil data pesanan terbaru
app.get('/api/latestPesanan', async (req, res) => {
  try {
      // Ambil data pesanan terbaru berdasarkan id terbesar
      const pesananResult = await pool.query(`
          SELECT p.id AS pesanan_id, p.nama_pasien, p.no_rm, p.umur, p.jenis_kelamin, p.keterangan
          FROM pesanan p
          ORDER BY p.id DESC
          LIMIT 1
      `);

      if (pesananResult.rows.length === 0) {
          return res.status(404).json({ message: 'Tidak ada pesanan' });
      }

      const pesanan_id = pesananResult.rows[0].pesanan_id;

      // Ambil data obat berdasarkan pesanan_id
      const obatResult = await pool.query(`
          SELECT nama_obat, jumlah, dosis
          FROM obat_pesanan
          WHERE pesanan_id = $1
      `, [pesanan_id]);

      res.json({
          pasien: pesananResult.rows[0],
          obat: obatResult.rows
      });
  } catch (err) {
      console.error('Error fetching latest pesanan:', err.message);
      res.status(500).json({ message: 'Gagal mengambil data pesanan terbaru' });
  }
});

// Endpoint untuk mengambil semua data pesanan
// Endpoint untuk mengambil semua data pesanan
// Endpoint untuk mengambil semua data pesanan
app.get('/api/orders', async (req, res) => {
    try {
        // Ambil semua data pesanan dan gabungkan dengan data rak
        const pesananResult = await pool.query(`
            SELECT p.id AS id, p.nik, p.nama_pasien, p.no_rm, p.umur, p.jenis_kelamin, p.keterangan, p.rak_id, r.nomor_rak
            FROM pesanan p
            LEFT JOIN rak r ON p.rak_id = r.id
            ORDER BY p.id ASC
        `);

        const pesananData = await Promise.all(
            pesananResult.rows.map(async (pesanan) => {
                // Ambil daftar obat berdasarkan pesanan_id
                const obatResult = await pool.query(`
                    SELECT nama_obat, jumlah, dosis
                    FROM obat_pesanan
                    WHERE pesanan_id = $1
                `, [pesanan.id]);  // Gunakan "pesanan.id" sebagai pesanan_id

                return {
                    ...pesanan,
                    obat: obatResult.rows // Tambahkan daftar obat ke data pesanan
                };
            })
        );

        res.json(pesananData);
    } catch (err) {
        console.error('Error fetching orders:', err.message);
        res.status(500).json({ message: 'Gagal mengambil data pesanan' });
    }
});




// Endpoint untuk mengubah status rak menjadi 'ready'
app.post('/api/updateRakStatus', async (req, res) => {
  const { rak_id } = req.body;

  try {
      const result = await pool.query(
          `UPDATE rak SET status = 'ready' WHERE id = $1`,
          [rak_id]
      );

      if (result.rowCount > 0) {
          res.status(200).json({ message: 'Rak status updated to ready' });
      } else {
          res.status(404).json({ message: 'Rak not found' });
      }
  } catch (err) {
      console.error('Error updating rak status:', err.message);
      res.status(500).json({ message: 'Gagal mengupdate status rak' });
  }
});

// Endpoint untuk mendapatkan status rak berdasarkan rak_id
app.get('/api/checkRakStatus', async (req, res) => {
  const { rak_id } = req.query;

  try {
      const result = await pool.query(
          `SELECT status FROM rak WHERE id = $1`,
          [rak_id]
      );

      if (result.rows.length > 0) {
          res.json({ status: result.rows[0].status });
      } else {
          res.status(404).json({ message: 'Rak tidak ditemukan' });
      }
  } catch (err) {
      console.error('Error checking rak status:', err.message);
      res.status(500).json({ message: 'Gagal memeriksa status rak' });
  }
});

app.post('/api/updateRakStatus', async (req, res) => {
    const { rak_id } = req.body;
  
    try {
        const result = await pool.query(
            `UPDATE rak SET status = 'ready' WHERE id = $1`,
            [rak_id]
        );
  
        if (result.rowCount > 0) {
            res.status(200).json({ message: 'Rak status updated to ready' });
        } else {
            res.status(404).json({ message: 'Rak not found' });
        }
    } catch (err) {
        console.error('Error updating rak status:', err.message);
        res.status(500).json({ message: 'Gagal mengupdate status rak' });
    }
  });

  app.post('/send-whatsapp', async (req, res) => {
    const { whatsappNumber, imageUrl } = req.body;

    console.log("Mengirim ke nomor WhatsApp:", whatsappNumber); // Log nomor yang digunakan

    try {
        await client.messages.create({
            from: 'whatsapp:+14155238886', // Ganti dengan nomor Twilio Sandbox Anda
            to: `${String(whatsappNumber)}`,
            body: 'Berikut QR Code untuk pesanan Anda.',
            mediaUrl: [imageUrl] 
        });
        res.status(200).send('Pesan WhatsApp berhasil dikirim.');
    } catch (error) {
        console.error('Error mengirim pesan WhatsApp:', error);
        res.status(500).send(`Gagal mengirim pesan WhatsApp: ${error.message}`);
    }
});


app.post('/save-qr', async (req, res) => {
    const { idPesanan, imageUrl } = req.body;

    try {
        // Unggah QR code ke Cloudinary
        const qrCloudUrl = await saveQrToCloudinary(imageUrl, idPesanan);
        console.log('Cloudinary URL:', qrCloudUrl);

        // Simpan URL QR di tabel pesanan di database
        await pool.query(
            `UPDATE pesanan SET qr_url = $1 WHERE id = $2`,
            [qrCloudUrl, idPesanan]
        );

        // Kembalikan URL publik
        res.json({ url: qrCloudUrl });
    } catch (error) {
        console.error('Error saving QR code to Cloudinary:', error);
        res.status(500).json({ message: 'Gagal menyimpan QR code ke Cloudinary' });
    }
});



async function saveQrToCloudinary(imageData, idPesanan) {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload(imageData, {
            folder: 'qr-images',
            public_id: idPesanan // Gunakan idPesanan sebagai ID publik agar unik
        }, (error, result) => {
            if (error) {
                console.error('Error uploading to Cloudinary:', error);
                return reject(error);
            }
            resolve(result.secure_url); // Mengembalikan URL publik dari Cloudinary
        });
    });
}



app.get('/get-qr-url', async (req, res) => {
    const { idPesanan } = req.query;
    try {
        // Ambil URL QR dari Cloudinary
        const result = await pool.query(
            `SELECT qr_url FROM pesanan WHERE id = $1`, [idPesanan]
        );
        if (result.rows.length > 0) {
            res.json({ url: result.rows[0].qr_url });
        } else {
            res.status(404).json({ message: 'QR code tidak ditemukan' });
        }
    } catch (error) {
        console.error('Error fetching QR URL:', error);
        res.status(500).json({ message: 'Gagal mengambil URL QR' });
    }
});


const PORT = 5005;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
