require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer'); // นำเข้า multer

const app = express();

// --- บรรทัดที่ต้องเพิ่มเพื่อให้ "upload" ทำงานได้ ---
const upload = multer({ storage: multer.memoryStorage() }); 

app.use(express.static('public')); 
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // เพิ่มเพื่อให้รับค่าจาก Form ปกติได้ด้วย

// --- 1. เชื่อมต่อ RDS (Database) ---
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 5432,
    ssl: { rejectUnauthorized: false }
});

// --- 2. เชื่อมต่อ S3 (Storage) ---
const s3 = new S3Client({ 
    region: process.env.AWS_REGION,
    // ถ้าคุณไม่ได้รันบน EC2 ที่มี IAM Role ต้องใส่ credentials ตรงนี้
    // แต่ถ้ารันบน EC2 ที่เซ็ต Role ไว้แล้ว ไม่ต้องใส่ครับ
});

// --- Route: ดึงรายการสินค้าจาก RDS ---
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id DESC');
        res.json({ products: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});


// เพิ่ม Route สำหรับการลบโดยรับ parameter เป็น id
app.delete('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params; // ดึง ID จาก URL
        
        // ใช้คำสั่ง SQL DELETE
        const query = 'DELETE FROM products WHERE id = $1';
        await pool.query(query, [id]);

        res.status(200).send('Product deleted successfully');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// --- Route: อัปโหลดรูปไป S3 และเก็บ Link ลง RDS ---
app.post('/upload', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const file = req.file;
    // ปรับให้เก็บไว้ใน folder 'products' ตามที่คุณตั้งใจ
    const fileName = `products/${Date.now()}_${file.originalname}`;

    try {
        // --- ส่วนที่ขาดหายไป: การส่งไฟล์ไป S3 จริงๆ ---
        const uploadParams = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: fileName,
            Body: file.buffer, // ข้อมูลรูปภาพจาก memoryStorage
            ContentType: file.mimetype,
            // ACL: 'public-read' // หากคุณเปิด ACL ใน S3 แล้ว ให้เอาคอมเมนต์บรรทัดนี้ออก
        };

        await s3.send(new PutObjectCommand(uploadParams));
        console.log("Successfully uploaded to S3:", fileName);
        // ------------------------------------------

        const name = req.body.item_name;
        const finder = req.body.finder_name;
        const desc = req.body.description;
        const phone = req.body.contact;

        // สร้าง URL ให้ถูกต้องตาม Region
        const imageUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

        console.log("Saving to DB:", { name, imageUrl });

        const query = `
            INSERT INTO products (name, finder_name, description, contact_number, image_url) 
            VALUES ($1, $2, $3, $4, $5)
        `;
        
        await pool.query(query, [name, finder, desc, phone, imageUrl]);

        res.json({ status: "Success", url: imageUrl });
    } catch (err) {
        console.error("Upload Error Details:", err);
        res.status(500).send("Upload Failed: " + err.message);
    }
});

// --- Health Check ---
app.get('/health', (req, res) => res.sendStatus(200));

app.listen(8080, () => console.log('Server running on port 8080'));