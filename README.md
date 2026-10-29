# KasetLink POS (Vercel + Munjai VPS)

โปรแกรม POS ร้านอาหารสัตว์/เกษตร พอร์ตจาก [Kasetlink-Pos](https://github.com/chaiyoot2-creator/Kasetlink-Pos) ให้ทำงานนอก FuseBase:

```
 เบราว์เซอร์ / แท็บเล็ตหน้าร้าน
        │  https://pos.ร้านคุณ.com  (Vercel — หน้าเว็บ React)
        ▼
 https://api.ร้านคุณ.com  ──►  Munjai Cloud VPS (Ubuntu 24.04, 151.242.34.51)
                              Nginx + Let's Encrypt → Node API (Hono, :3001)
                              PostgreSQL 16 (RLS ตาม org_id)
                              รูปสินค้า /var/lib/kasetlink-pos/uploads
                              สำรอง pg_dump ──rclone──► Google Drive (อัตโนมัติ)
```

| โฟลเดอร์ | คืออะไร |
| --- | --- |
| `src/` | หน้าเว็บ (Vite + React + shadcn) — deploy ขึ้น Vercel |
| `backend/` | API (Node 22 + Hono + pg) — รันบน VPS ด้วย systemd |
| `postgres/migrations/` | โครงสร้างฐานข้อมูล (0001–0015) รันอัตโนมัติทุกครั้งที่อัปเดต |
| `deploy/` | สคริปต์ติดตั้ง VPS, อัปเดต, เชื่อม Google Drive |

## สิ่งที่เปลี่ยนจากต้นฉบับ

- `backend/src/db.ts` แทน `gate.ts` — ต่อ PostgreSQL ตรง ทุกคำสั่งรันใน transaction ที่ตั้ง `app.org_id` ไว้ นโยบาย RLS เดิมจึงยังทำงาน
- ระบบล็อกอินพนักงาน สิทธิ์ และบทบาท ใช้ของเดิมทั้งหมด (ไม่ต้องพึ่ง FuseBase แล้ว)
- รูปสินค้าเก็บบนดิสก์ VPS แทน FuseBase Files
- สำรองข้อมูล: จาก Google Sheet (Apps Script) → **pg_dump + rclone → Google Drive** ตั้งเวลาได้ในหน้า ตั้งค่า (ทุกชั่วโมง / ทุก 6 ชั่วโมง / วันละครั้ง) เก็บย้อนหลัง 30 วัน
- โมดูลอื่น (บัญชี, ฟาร์มสุข, จัดส่ง, ใบเสนอราคา) ติดมาด้วยเพราะใช้ฐานข้อมูลชุดเดียวกัน แต่ยังทดสอบเฉพาะส่วนหลัก: ล็อกอิน, สินค้า, สต็อก, ขาย, รูป, สำรองข้อมูล

---

## ขั้นตอนติดตั้ง (ทำครั้งเดียว)

### 0. ความปลอดภัยก่อนเริ่ม

รหัสผ่าน VPS ที่แสดงในหน้า Munjai Panel ควรเปลี่ยนใหม่ทันที แล้วใช้ SSH key แทนรหัสผ่าน (บน PC ใน Git Bash หรือ PowerShell):

```bash
ssh-keygen -t ed25519 -C "kasetlink-pos"
```

```bash
cat ~/.ssh/id_ed25519.pub | ssh munjai-user@151.242.34.51 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

จากนั้นล็อกอินแล้วเปลี่ยนรหัสผ่านด้วย `passwd`

### 1. ตั้ง DNS ที่ผู้ให้บริการโดเมน

| ชื่อ | ชนิด | ค่า |
| --- | --- | --- |
| `api` | A | `151.242.34.51` |
| `pos` | CNAME | ค่าที่ Vercel ให้ตอนเพิ่มโดเมน (ขั้นตอน 5) |

รอจน `ping api.ร้านคุณ.com` ได้ IP 151.242.34.51 ก่อนทำขั้นตอน 3 (Let's Encrypt ต้องใช้)

### 2. อัปโหลดโค้ด API ขึ้น VPS (จาก PC, Git Bash)

```bash
VPS=munjai-user@151.242.34.51 SETUP=1 bash deploy/push.sh
```

### 3. ติดตั้งบน VPS

```bash
ssh munjai-user@151.242.34.51
```

แล้วรัน (เปลี่ยนโดเมนและอีเมลเป็นของคุณ):

```bash
sudo API_DOMAIN=api.ร้านคุณ.com WEB_ORIGINS=https://pos.ร้านคุณ.com,https://kasetlink-pos.vercel.app CERT_EMAIL=you@example.com bash /opt/kasetlink-pos/src/deploy/setup-vps.sh
```

สคริปต์จะติดตั้ง Node 22, PostgreSQL 16, Nginx, Certbot (SSL), UFW, Fail2Ban, rclone สร้างฐานข้อมูลพร้อมรหัสผ่านสุ่ม (เก็บใน `/etc/kasetlink-pos/api.env`) รัน migration และเปิดบริการ `kasetlink-pos` ตรวจด้วย:

```bash
curl https://api.ร้านคุณ.com/api/health
```

### 4. เชื่อม Google Drive สำหรับสำรองข้อมูล

บน VPS:

```bash
sudo bash /opt/kasetlink-pos/src/deploy/setup-drive.sh
```

VPS ไม่มีเบราว์เซอร์ rclone จะแสดงคำสั่ง `rclone authorize "drive" "..."` ให้คัดลอกไปรันบน **PC ของคุณ** (มี rclone อยู่แล้ว) → ล็อกอินบัญชี Google ของร้าน → คัดลอก token ที่ได้มาวางในหน้าจอ VPS

ใช้สิทธิ์ `drive.file` — rclone เห็นเฉพาะไฟล์ที่ตัวเองสร้าง (โฟลเดอร์ `KasetLink-POS-Backup`) ไม่เห็นไฟล์อื่นใน Drive

### 5. เชื่อม Vercel (หน้าเว็บ)

1. สร้าง repo ใหม่บน GitHub แล้ว push โฟลเดอร์นี้ขึ้นไป
2. [vercel.com/new](https://vercel.com/new) → Import repo → Framework: **Vite**, Root Directory: `./` (ค่าใน `vercel.json` ตั้งไว้แล้ว)
3. Environment Variables: `VITE_API_URL` = `https://api.ร้านคุณ.com`
4. Deploy → Settings → Domains → เพิ่ม `pos.ร้านคุณ.com` แล้วตั้ง CNAME ตามที่ Vercel บอก
5. ถ้า URL ของ Vercel ไม่ตรงกับ `WEB_ORIGINS` ในขั้นตอน 3 ให้แก้ `CORS_ORIGINS` ใน `/etc/kasetlink-pos/api.env` แล้ว `sudo systemctl restart kasetlink-pos`

### 6. เริ่มใช้งาน

เปิด `https://pos.ร้านคุณ.com` → สร้างบัญชีเจ้าของร้าน → ตั้งชื่อร้าน → ไปที่ **ตั้งค่า → สำรองข้อมูลไป Google Drive** → กด *ทดสอบการเชื่อมต่อ* และ *สำรองเดี๋ยวนี้* → เปิด *สำรองอัตโนมัติ* แล้วบันทึก

---

## การอัปเดต

- หน้าเว็บ: `git push` → Vercel deploy ให้อัตโนมัติ
- API: จาก PC

```bash
VPS=munjai-user@151.242.34.51 bash deploy/push.sh
```

## กู้คืนจากไฟล์สำรอง

ดาวน์โหลดไฟล์ `.dump` จาก Google Drive (หรือใช้ไฟล์ใน `/var/backups/kasetlink-pos` บน VPS) แล้วบน VPS:

```bash
sudo systemctl stop kasetlink-pos
```

```bash
sudo -u postgres env PGOPTIONS='-c app.org_id=main' pg_restore --clean --if-exists --no-owner --role=pos --enable-row-security -d kasetlink_pos /path/to/kasetlink-pos_2026-10-30_0200.dump
```

```bash
sudo systemctl start kasetlink-pos
```

## พัฒนาบนเครื่อง

```bash
npm install && npm --prefix backend install
```

ต้องมี PostgreSQL (หรือ `npm --prefix backend run dev:db` ใช้ embedded-postgres — บน Windows ต้องวางโปรเจกต์ใน path สั้น ๆ เช่น `C:\dev\kasetlink-pos`) แล้วตั้ง `DATABASE_URL` ตาม `backend/.env.example`:

```bash
npm --prefix backend run migrate:dev
```

```bash
npm --prefix backend run dev
```

```bash
npm run dev
```

เปิด http://localhost:5173 (Vite ส่ง `/api` ต่อไปที่ :3001 ให้เอง)

## ดูสถานะ/ปัญหาบน VPS

```bash
sudo journalctl -u kasetlink-pos -n 100 --no-pager
```

ดูบทความประกอบ: [ติดตั้ง SSL](https://article.munjai-solution.com/add-ssl-website-munjai/), [Fail2Ban](https://article.munjai-solution.com/fail2ban/), [ติดตั้งบน VPS Ubuntu 24.04](https://article.munjai-solution.com/install-wordpress-vps-ubuntu24-04/)
