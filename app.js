require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer'); // สำหรับจัดการไฟล์ที่อัปโหลดมาที่ Express

const app = express();
app.use(express.static('public')); // <--- บรรทัดที่ 1: บอกให้ใช้ไฟล์ในโฟลเดอร์ public
app.use(express.json());

// --- 1. เชื่อมต่อ RDS (Database) ---
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 5432,
    ssl: { rejectUnauthorized: false } // สำคัญมากสำหรับการต่อ RDS
});

// --- 2. เชื่อมต่อ S3 (Storage) ---
const s3 = new S3Client({ region: process.env.AWS_REGION });

// --- Route: ดึงรายการสินค้าจาก RDS ---
app.get('/api/products', async (req, res) => { // <--- เปลี่ยนชื่อเป็น /api/products
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id DESC');
        res.json({ products: result.rows });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// --- Route: อัปโหลดรูปไป S3 และเก็บ Link ลง RDS ---
app.post('/upload', upload.single('image'), async (req, res) => {
    const file = req.file;
    const fileName = `products/${Date.now()}_${file.originalname}`;

    try {
        // A. ส่งไฟล์ไป S3
        await s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: fileName,
            Body: file.buffer,
            ContentType: file.mimetype
        }));

        const imageUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

        // B. บันทึก Link รูปภาพลงใน RDS
        await pool.query('INSERT INTO products (name, image_url) VALUES ($1, $2)', 
            [req.body.name, imageUrl]);

        res.json({ status: "Success", url: imageUrl });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// --- Health Check สำหรับ Load Balancer ---
app.get('/health', (req, res) => res.sendStatus(200));

app.listen(8080, () => console.log('Server running on port 8080'));