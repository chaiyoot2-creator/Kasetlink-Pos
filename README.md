# KasetLink POS (Vercel + Munjai VPS)

โปรแกรม POS ร้านอาหารสัตว์/เกษตร พอร์ตจาก [Kasetlink-Pos](https://github.com/chaiyoot2-creator/Kasetlink-Pos) (branch `main` = เวอร์ชัน FuseBase เดิม) ให้ทำงานนอก FuseBase

## ระบบที่ใช้งานจริง

| ส่วน | ที่อยู่ |
| --- | --- |
| หน้าเว็บ (Vercel โปรเจกต์ `kasetlink-pos`) | https://pos.theeratfeed.co.th (สำรอง: https://kasetlink-pos.vercel.app) |
| API (VPS Munjai 151.242.34.51) | https://pos-api.151-242-34-51.sslip.io — Docker ผ่าน Traefik ของ Coolify |
| โค้ดบน VPS | `/opt/kasetlink-pos` (`deploy/coolify/docker-compose.yml`) |
| Secrets | `/opt/kasetlink-pos/.env` บน VPS เท่านั้น (รหัสผ่านฐานข้อมูลสุ่มตอน deploy ครั้งแรก) |
| สำรองข้อมูล | pg_dump → Google Drive โฟลเดอร์ `KasetLink-POS-Backup` ตั้งเวลาได้ในหน้า ตั้งค่า เก็บ 30 วัน |

```
 แท็บเล็ต/คอมหน้าร้าน ──► https://pos.theeratfeed.co.th (Vercel, React)
                              │ /api/*  (Vercel rewrite — โดเมนเดียวกัน ไม่ต้องตั้ง CORS)
                              ▼
            https://pos-api.151-242-34-51.sslip.io (Traefik ของ Coolify + Let's Encrypt)
                              ▼
            container kasetlink-pos-api-1 (Node 22 + Hono) ── kasetlink-pos-db-1 (PostgreSQL 17, RLS)
                              │ volume data: รูปสินค้า, ไฟล์ .dump, rclone.conf
                              └─ rclone ──► Google Drive
```

> VPS เครื่องนี้มี **Coolify และ 888bike HR** ทำงานอยู่ด้วย — ห้ามรัน `deploy/setup-vps.sh` (Nginx/Certbot/UFW จะชนกับ Coolify)
> สคริปต์นั้นใช้กับ VPS ใหม่ที่ว่างเท่านั้น

| โฟลเดอร์ | คืออะไร |
| --- | --- |
| `src/` | หน้าเว็บ (Vite + React + shadcn) |
| `backend/` | API (Hono + pg) — `backend/Dockerfile` |
| `postgres/migrations/` | โครงสร้างฐานข้อมูล รันอัตโนมัติทุกครั้งที่ container เริ่ม |
| `deploy/coolify/` | docker-compose, deploy จาก PC, เชื่อม Google Drive |

## สิ่งที่เปลี่ยนจากต้นฉบับ FuseBase

- `backend/src/db.ts` แทน `gate.ts` — ต่อ PostgreSQL ตรง ทุกคำสั่งรันใน transaction ที่ตั้ง `app.org_id` นโยบาย RLS เดิมจึงยังทำงาน (role `pos` ไม่ใช่ superuser)
- ระบบล็อกอินพนักงาน สิทธิ์ และบทบาท ใช้ของเดิม
- รูปสินค้าเก็บใน volume ของ VPS แทน FuseBase Files
- สำรองข้อมูล: จาก Google Sheet → **pg_dump + rclone → Google Drive**
- โมดูลบัญชี, ฟาร์มสุข, จัดส่ง, ใบเสนอราคา ติดมาด้วย แต่ทดสอบแล้วเฉพาะส่วนหลัก (ล็อกอิน สินค้า สต็อก ขาย รูป สำรองข้อมูล)

## ตั้งค่าครั้งแรก

1. **DNS** (DirectAdmin ของ Bangmod → theeratfeed.co.th → DNS Management) เพิ่ม
   `CNAME` ชื่อ `pos` ค่า `fe709ea46d7e5292.vercel-dns-017.com.`
2. **API:** จาก PC (Git Bash, ใช้ SSH key ที่ตั้งไว้แล้ว)
   ```bash
   bash deploy/coolify/deploy.sh
   ```
3. **Google Drive:**
   ```bash
   ssh -t munjai-user@151.242.34.51 "sudo bash /opt/kasetlink-pos/deploy/coolify/setup-drive.sh"
   ```
   rclone จะแสดง `rclone authorize "drive" "..."` → รันบน PC → ล็อกอิน Google ของร้าน → วาง token กลับในหน้าต่าง SSH
   (สิทธิ์ `drive.file` — rclone เห็นเฉพาะไฟล์ที่ตัวเองสร้าง)
4. เปิด https://pos.theeratfeed.co.th → สร้างบัญชีเจ้าของร้าน → **ตั้งค่า → สำรองข้อมูลไป Google Drive** → ทดสอบ / สำรองเดี๋ยวนี้ → เปิดสำรองอัตโนมัติ

## อัปเดต

- **API:** commit แล้ว `bash deploy/coolify/deploy.sh` (ส่งโค้ด HEAD ขึ้น VPS แล้ว build ใหม่)
- **หน้าเว็บ:** `bash deploy/vercel-deploy.sh` (Vercel ยังไม่ได้เชื่อม GitHub repo นี้ — ถ้าเชื่อมได้ภายหลัง git push จะ deploy เอง)

## ดู log / กู้คืน

```bash
ssh munjai-user@151.242.34.51 "sudo docker logs kasetlink-pos-api-1 --tail 100"
```

กู้คืนจากไฟล์ `.dump` (ดาวน์โหลดจาก Drive หรือใช้ไฟล์ใน volume `/data/backups`):

```bash
ssh munjai-user@151.242.34.51
```

```bash
cd /opt/kasetlink-pos && sudo docker compose -f deploy/coolify/docker-compose.yml --env-file .env stop api
```

```bash
sudo docker exec -i -e PGOPTIONS='-c app.org_id=main' kasetlink-pos-db-1 pg_restore -U pos -d kasetlink_pos --clean --if-exists --no-owner --enable-row-security < kasetlink-pos_2026-10-30_0200.dump
```

```bash
sudo docker compose -f deploy/coolify/docker-compose.yml --env-file .env start api
```

## พัฒนาบนเครื่อง

ต้องมี PostgreSQL ที่มี role ไม่ใช่ superuser (ดู `backend/.env.example`) แล้ว:

```bash
npm install && npm --prefix backend install
```

```bash
npm --prefix backend run migrate:dev
```

```bash
npm --prefix backend run dev
```

```bash
npm run dev
```

เปิด http://localhost:5173 (Vite ส่ง `/api` ต่อไปที่ :3001)
