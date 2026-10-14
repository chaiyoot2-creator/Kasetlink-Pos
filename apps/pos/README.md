# KasetLink POS (เฟส 2)

ระบบขายหน้าร้านอาหารสัตว์ ภาษาไทยทั้งหมด ใช้ได้บนคอมพิวเตอร์ แท็บเล็ต และมือถือ

## สถาปัตยกรรม

| ส่วน | เทคโนโลยี | เหตุผล |
|---|---|---|
| หน้าจอ | React 18 + Vite + Tailwind v4 + shadcn/ui (`src/`) | template มาตรฐานของ FuseBase |
| API | Hono backend (`backend/`) | รวมตรรกะธุรกิจ (FEFO, ต้นทุนถัวเฉลี่ย, วงเงินเครดิต) ไว้ที่เดียว และเผยแพร่เป็น App API (`openapi.json`) ให้แอปอื่น เช่น AI Vision เรียกใช้ได้ |
| ฐานข้อมูล | FuseBase PostgreSQL (Gate isolated store, alias `kasetlink-pos`) | ข้อมูลเชิงธุรกรรม ต้องใช้ transaction + RLS แยกตามองค์กร |
| ธุรกรรม | `runIsolatedStoreSqlBatch` (สูงสุด 25 คำสั่ง, all-or-nothing) | ทุกบิล / รับเข้า / โอน / ปรับยอด บันทึกในทรานแซกชันเดียว |

Migration อยู่ที่ `postgres/migrations/` (สร้าง bundle ด้วย `fusebase isolated-store sql bundle --app apps/pos`)

## กติกาสต็อกและต้นทุน

- **แหล่งความจริงของสต็อก** = `stock_lots` (สินค้า × โซน × เลขล็อต × วันหมดอายุ) มี `CHECK (qty >= 0)` กันสต็อกติดลบเมื่อหลายเครื่องขายพร้อมกัน
- **ตัดสต็อกแบบ FEFO** — ล็อตที่หมดอายุก่อนออกก่อน; การขายจะข้ามล็อตที่หมดอายุแล้ว
- **ต้นทุนถัวเฉลี่ยเคลื่อนที่** ระดับสินค้า: คำนวณใหม่ตอนรับเข้า / ยกเลิกบิล / ปรับยอดยกมา; ต้นทุนขาย = `avg_cost` ณ เวลาขาย เก็บใน `sale_lines.unit_cost`
- ส่วนลดท้ายบิลกระจายลงแต่ละรายการตามสัดส่วน (`bill_discount_share`) เพื่อให้กำไรรายสินค้าถูกต้อง

## Event สำหรับ AI Vision

ทุกการกระทำที่กระทบบิลหรือสต็อกเขียน 1 แถวลง `pos_events` (append-only) และทุกการเคลื่อนไหวสต็อกใน `stock_movements` อ้างอิง `event_id` เดียวกัน

| ฟิลด์ | ความหมาย |
|---|---|
| `event_id` | UUID ที่เครื่องสร้าง (ใช้กันบันทึกซ้ำ — ส่งซ้ำได้อย่างปลอดภัย) |
| `terminal_id` | รหัสเครื่อง (เก็บใน localStorage ของอุปกรณ์) |
| `zone_id` | โซน/สาขาที่เกิดเหตุการณ์ (`locations.id`) |
| `occurred_at` / `recorded_at` | เวลาที่เกิดบนเครื่อง / เวลาที่เซิร์ฟเวอร์บันทึก |
| `event_type` | `sale.completed`, `sale.voided`, `stock.received`, `stock.transferred`, `stock.adjusted`, `po.created`, `po.cancelled`, `ar.payment_received` |
| `source` | `pos` (สำรองไว้สำหรับ `ai_vision` ในอนาคต) |
| `payload` | รายละเอียดเต็ม (รายการ, ล็อตที่ถูกตัด ฯลฯ) |

อ่าน event ได้ที่ `GET /api/events?since=<ISO>&type=&zoneId=` (operation `listPosEvents`, visibility `org`)

## ข้อจำกัดของ Gate ที่ต้องรู้

- `execute` รับเฉพาะคำสั่งที่ขึ้นต้นด้วย `INSERT` / `UPDATE` / `DELETE` — ห้ามใช้ `WITH ...` (CTE)
- เงื่อนไขป้องกัน (เช่น วงเงินเครดิต, รับเกิน PO) ใช้ `guardTerm()` ฝังการหารศูนย์ใน `SET` ให้ทรานแซกชัน rollback
- เลขที่เอกสารใช้ 2 คำสั่ง: `counterBumpSql` แล้ว `docNoSql()` ภายใน INSERT
