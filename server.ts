import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Create database connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
let localChatMessages: any[] = [];
async function loadChatHistory() {
  try {
    const [rows]: any = await pool.query(
      "SELECT role, content, username, timestamp FROM messages ORDER BY timestamp ASC"
    );
    localChatMessages = rows.map((r: any) => ({
      role: r.role,
      content: r.content,
      username: r.username,
      timestamp: r.timestamp
    }));
    console.log(`Loaded ${localChatMessages.length} messages from database.`);
  } catch (err) {
    console.error("Failed to load chat messages from DB, starting fresh in-memory:", err);
  }
}
loadChatHistory();

let userIdToNameMap: Record<number, string> = {};

async function loadUserMap() {
  try {
    const [rows]: any = await pool.query("SELECT user_id, user_name FROM tbl_users");
    const newMap: Record<number, string> = {};
    for (const r of rows) {
      newMap[r.user_id] = r.user_name;
    }
    userIdToNameMap = newMap;
  } catch (err) {
    console.error("Failed to load user map:", err);
  }
}
loadUserMap();

async function resolveUserIdByName(name: string): Promise<number> {
  const trimmed = (name || "").trim().toLowerCase();
  if (!trimmed) return 0;
  try {
    const [rows]: any = await pool.query(
      "SELECT user_id FROM tbl_users WHERE LOWER(user_name) = ? OR LOWER(user_username) = ? LIMIT 1",
      [trimmed, trimmed]
    );
    if (rows && rows[0]) {
      return rows[0].user_id;
    }
  } catch (err) {
    console.error(`Failed to resolve user ID for name "${name}":`, err);
  }
  return 0;
}

// Helper: Normalize service requests / leads status
function mapDbStatusToLead(dbStatus: string): string {
  if (dbStatus === "new") return "New Lead";
  if (dbStatus === "hold") return "Hold";
  if (dbStatus === "ongoing") return "Proposed";
  if (dbStatus === "completed") return "Won";
  return "Deleted";
}

function mapLeadStatusToDb(leadStatus: string): string {
  const s = (leadStatus || "").toLowerCase();
  if (s.includes("new")) return "new";
  if (s.includes("hold")) return "hold";
  if (s.includes("propos") || s.includes("ongo")) return "ongoing";
  return "completed";
}

// 1. Authentication Portal Login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const trimmedUser = String(username).trim();
    const trimmedPass = String(password).trim();

    // Query user by username
    const [rows]: any = await pool.query(
      "SELECT user_id, user_name, user_username, user_password, user_type FROM tbl_users WHERE user_username = ? LIMIT 1",
      [trimmedUser]
    );

    let user = rows[0];
    if (!user) {
      // Fallback to case-insensitive match
      const [fallbackRows]: any = await pool.query(
        "SELECT user_id, user_name, user_username, user_password, user_type FROM tbl_users WHERE LOWER(user_username) = ? LIMIT 1",
        [trimmedUser.toLowerCase()]
      );
      user = fallbackRows[0];
    }

    if (user && user.user_password) {
      // Compare bcrypt hash
      const isMatch = bcrypt.compareSync(trimmedPass, user.user_password);
      if (isMatch) {
        return res.json({
          success: true,
          name: user.user_name,
          role: user.user_type === "Admin" ? "admin" : "staff",
          token: `jwt-db-token-${user.user_id}-${Date.now()}`
        });
      }
    }

    return res.status(401).json({ error: "User unauthorized. Please check portal credentials." });
  } catch (err: any) {
    console.error("Login route error:", err);
    return res.status(500).json({ error: "Database login query failed." });
  }
});

// 2. Query Active Users List
app.get("/api/users", async (req, res) => {
  try {
    const [rows]: any = await pool.query(
      "SELECT user_id, user_name, user_username, user_type FROM tbl_users WHERE user_status = 'active'"
    );
    const mapped = rows.map((u: any) => ({
      id: u.user_id,
      name: u.user_name,
      username: u.user_username,
      role: u.user_type === "Admin" ? "admin" : "staff"
    }));
    return res.json(mapped);
  } catch (err) {
    console.error("Users list query failed:", err);
    return res.status(500).json({ error: "Failed to fetch user directory." });
  }
});

app.get("/api/data", async (req, res) => {
  console.log("--> GET /api/data received");
  try {
    await loadUserMap();
    console.log("Querying tbl_customer_services_beta...");
    // A. Query registrations and services from tbl_customer_services_beta
    const [serviceRows]: any = await pool.query(
      "SELECT * FROM tbl_customer_services_beta ORDER BY customer_service_id DESC LIMIT 350"
    );
    console.log(`Querying tbl_customer_services_beta completed. Found ${serviceRows.length} rows.`);

    console.log("Querying customers...");
    // B. Query customers without join
    const [customerRows]: any = await pool.query(
      `SELECT id, name, contact_name AS contactName, phone, email, region, implementation_type AS implementationType, 
              vehicle_count AS vehicleCount, address 
       FROM customers 
       ORDER BY id DESC LIMIT 250`
    );
    console.log(`Querying customers completed. Found ${customerRows.length} rows.`);

    const customerIds = customerRows.map((c: any) => c.id);
    let locatorMap: Record<number, any> = {};

    if (customerIds.length > 0) {
      console.log("Querying customers_locator in-memory join mapping...");
      const [locatorRows]: any = await pool.query(
        `SELECT customer_id, customer_username, locator_plan 
         FROM customers_locator 
         WHERE customer_id IN (${customerIds.map(() => "?").join(",")})`,
        customerIds
      );
      for (const row of locatorRows) {
        locatorMap[row.customer_id] = row;
      }
      console.log(`Loaded ${locatorRows.length} locator mappings.`);
    }

    // Map tbl_customer_services_beta to Registrations (Leads feed)
    const registrations = serviceRows.map((r: any) => ({
      id: r.customer_service_id,
      customerName: r.customer_service_customer_name,
      contactName: r.customer_service_customer_contact_name || "",
      phone: r.customer_service_customer_phone || "",
      email: r.customer_service_customer_email || "",
      region: r.region || "Dubai",
      status: mapDbStatusToLead(r.customer_service_status),
      implementationType: r.customer_service_customer_type || "LOCATOR",
      salesPerson: userIdToNameMap[r.customer_service_L1_assigned_to] || "Unassigned",
      requestedPerson: userIdToNameMap[r.requested_by] || "Unassigned",
      projectValue: String(r.customer_service_amount || "0"),
      comment: r.customer_service_description || "",
      newQty: r.customer_service_quantity || 1,
      migrateQty: 0,
      tradingQty: 0,
      serviceQty: 0,
      otherQty: 0,
      createdAt: r.created_at || r.customer_service_created_date || new Date().toISOString()
    }));

    // Map tbl_customer_services_beta to Service Tickets
    const services = serviceRows.map((r: any) => ({
      id: r.customer_service_id,
      ticketId: `TKT-${String(r.customer_service_id).padStart(5, "0")}`,
      customerName: r.customer_service_customer_name,
      description: r.customer_service_description || "",
      status: r.customer_service_status === "new" ? "New" :
        r.customer_service_status === "hold" ? "Hold" :
          r.customer_service_status === "ongoing" ? "Ongoing" :
            r.customer_service_status === "completed" ? "Completed" : "Followed up",
      quantity: r.customer_service_quantity || 1,
      requestedPerson: userIdToNameMap[r.requested_by] || "Unassigned",
      payment: r.customer_service_payment === "applicable" ? "Applicable" : "Not Applicable",
      invoiceStatus: r.customer_service_invoice_status === "invoiced" ? "Invoiced" : "Not Invoiced",
      paymentStatus: r.customer_service_payment_status === "paid" ? "Paid" : "Not Paid",
      amount: String(r.customer_service_amount || "0"),
      assignee: userIdToNameMap[r.customer_service_L1_assigned_to] || "Unassigned",
      createdAt: r.created_at || r.customer_service_created_date || new Date().toISOString()
    }));

    // Map Customer accounts
    const customers = customerRows.map((c: any) => {
      const loc = locatorMap[c.id] || {};
      return {
        id: c.id,
        name: c.name,
        contactName: c.contactName || "",
        phone: c.phone || "",
        email: c.email || "",
        region: c.region || "Dubai",
        implementationType: c.implementationType || "LOCATOR",
        vehicleCount: c.vehicleCount || 0,
        customerUsername: loc.customer_username || "",
        locatorPlan: loc.locator_plan || "Older Version",
        address: c.address || ""
      };
    });

    return res.json({ registrations, services, customers });
  } catch (err: any) {
    console.error("Fetch data route failed:", err);
    return res.status(500).json({ error: "Failed to query system dashboard data." });
  }
});

// 4. Create New Lead / Service Ticket
app.post("/api/leads/new", async (req, res) => {
  const body = req.body;
  try {
    const assigneeName = body.assignee || body.salesPerson;
    const reqName = body.requestedPerson;
    if (!assigneeName && !reqName) {
      return res.status(400).json({ error: "Level 1 Assignee and Requested Person cannot both be empty" });
    }

    const [maxRows]: any = await pool.query("SELECT MAX(customer_service_id) AS max_id FROM tbl_customer_services_beta");
    const nextId = (maxRows[0].max_id || 1000) + 1;

    const resolvedAssignee = assigneeName || reqName;
    const L1_assigned_to = await resolveUserIdByName(resolvedAssignee);
    const reqUserId = await resolveUserIdByName(reqName || "admin");

    const descVal = body.comment || body.description || "";
    const qtyVal = parseInt(body.newQty || body.quantity || "1") || 1;

    const payment = body.paymentOption || body.payment;
    const paymentVal = payment ? (payment.toLowerCase().replace(/\s+/g, "") === "applicable" ? "applicable" : "notapplicable") : null;

    const amount = body.projectValue || body.amount;
    const amountVal = (amount !== undefined && amount !== null && amount !== "") ? parseInt(amount) : null;

    const payStatus = body.paymentStatus;
    const payStatusVal = payStatus ? (payStatus.toLowerCase().replace(/\s+/g, "") === "paid" ? "paid" : "notpaid") : null;
    const mapLinkVal = body.mapLink || body.link || null;

    let customerExpDate: any = null;
    let locatorPlanVal: any = null;
    try {
      const [locRows]: any = await pool.query(
        "SELECT customer_expiry_date, locator_plan FROM customers_locator WHERE customer_name = ? LIMIT 1",
        [body.customerName]
      );
      if (locRows && locRows[0]) {
        customerExpDate = locRows[0].customer_expiry_date;
        locatorPlanVal = locRows[0].locator_plan;
      }
    } catch (err) {
      console.error("Failed to query customer_expiry_date/locator_plan from customers_locator:", err);
    }

    await pool.query(
      `INSERT INTO tbl_customer_services_beta (
        customer_service_id, 
        customer_service_customer_id,
        customer_service_customer_name, 
        customer_service_customer_contact_name, 
        customer_service_customer_phone, 
        customer_service_customer_email, 
        customer_service_customer_address, 
        customer_service_address_map,
        region, 
        customer_service_customer_type, 
        customer_service_description, 
        customer_service_status, 
        customer_service_quantity, 
        customer_service_payment, 
        customer_service_amount, 
        customer_service_payment_status, 
        customer_service_L1_assigned_to,
        requested_by,
        customer_service_created_by,
        customer_service_customer_exp_date,
        locator_plan,
        customer_service_created_date
      ) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        nextId,
        body.customerName,
        body.contactName || null,
        body.phone || null,
        body.email || null,
        body.address || null,
        mapLinkVal,
        body.region || null,
        body.implementationType || "LOCATOR",
        descVal,
        qtyVal,
        paymentVal,
        amountVal,
        payStatusVal,
        L1_assigned_to || 0,
        reqUserId || 0,
        reqUserId || 0,
        customerExpDate,
        locatorPlanVal
      ]
    );

    return res.json({ id: nextId, ...body });
  } catch (err: any) {
    console.error("Create lead failed:", err);
    return res.status(500).json({ error: "Failed to insert lead registration into remote database." });
  }
});

// 5. Update Lead / Service Ticket
app.put("/api/leads/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const body = req.body;
  try {
    const assigneeName = body.assignee || body.salesPerson || body.requestedPerson;
    const L1_assigned_to = assigneeName ? await resolveUserIdByName(assigneeName) : null;

    const queryParts = [];
    const queryParams = [];

    if (body.customerName) { queryParts.push("customer_service_customer_name = ?"); queryParams.push(body.customerName); }
    if (body.contactName) { queryParts.push("customer_service_customer_contact_name = ?"); queryParams.push(body.contactName); }
    if (body.phone) { queryParts.push("customer_service_customer_phone = ?"); queryParams.push(body.phone); }
    if (body.email) { queryParts.push("customer_service_customer_email = ?"); queryParams.push(body.email); }
    if (body.status) {
      queryParts.push("customer_service_status = ?");
      queryParams.push(mapLeadStatusToDb(body.status));
    }
    if (body.quantity !== undefined || body.newQty !== undefined) {
      queryParts.push("customer_service_quantity = ?");
      queryParams.push(body.quantity || body.newQty || 1);
    }
    if (body.projectValue !== undefined || body.amount !== undefined) {
      queryParts.push("customer_service_amount = ?");
      queryParams.push(parseInt(body.projectValue || body.amount || "0"));
    }
    if (L1_assigned_to !== null) {
      queryParts.push("customer_service_L1_assigned_to = ?");
      queryParams.push(L1_assigned_to);
    }

    if (queryParts.length > 0) {
      queryParams.push(id);
      await pool.query(
        `UPDATE tbl_customer_services_beta SET ${queryParts.join(", ")} WHERE customer_service_id = ?`,
        queryParams
      );
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error("Update lead failed:", err);
    return res.status(500).json({ error: "Failed to update record in remote database." });
  }
});

// 6. Create Service Ticket (Wrapper for the same table tbl_customer_services_beta)
app.post("/api/services", async (req, res) => {
  const body = req.body;
  try {
    const customerNameVal = (body.customerName || "").trim();
    if (!customerNameVal) {
      return res.status(400).json({ error: "Customer name is required" });
    }

    // Check if customer exists in the DB
    const [exactMatches]: any = await pool.query(
      "SELECT id, name FROM customers WHERE name = ? LIMIT 1",
      [customerNameVal]
    );

    let customerId = 0;
    let finalCustomerName = customerNameVal;

    // Only use exact match if the name is a PRECISE case-sensitive match
    // (avoid eating 'fujairah' lowercase junk record when user searches 'Fujairah')
    const preciseExact = exactMatches && exactMatches.length > 0 &&
      exactMatches[0].name === customerNameVal;
    
    if (preciseExact) {
      customerId = exactMatches[0].id;
      finalCustomerName = exactMatches[0].name;
    } else {
      // Fuzzy word matching
      const words = customerNameVal
        .split(/\s+/)
        .map((w: string) => w.trim())
        .filter((w: string) => w.length >= 2); // only words with length >= 2

      let candidates: any[] = [];
      if (words.length > 0) {
        // Try AND matching first for precise intersection matches
        const andClauses = words.map(() => "name LIKE ?").join(" AND ");
        const andParams = words.map((w: string) => `%${w}%`);
        const [andRows]: any = await pool.query(
          `SELECT id, name FROM customers WHERE ${andClauses} LIMIT 50`,
          andParams
        );
        
        let fuzzyRows = andRows || [];
        
        // If less than 5 matches are found, supplement with OR query
        if (fuzzyRows.length < 5) {
          const orClauses = words.map(() => "name LIKE ?").join(" OR ");
          const orParams = words.map((w: string) => `%${w}%`);
          const [orRows]: any = await pool.query(
            `SELECT id, name FROM customers WHERE ${orClauses} LIMIT 100`,
            orParams
          );
          
          const seenIds = new Set(fuzzyRows.map((r: any) => r.id));
          for (const row of (orRows || [])) {
            if (!seenIds.has(row.id)) {
              fuzzyRows.push(row);
              seenIds.add(row.id);
            }
          }
        }
        
        const scored = (fuzzyRows || []).map((row: any) => {
          const nameLower = row.name.toLowerCase();
          let score = 0;
          let matchedWordsCount = 0;
          
          for (const w of words) {
            const wLower = w.toLowerCase();
            if (nameLower.includes(wLower)) {
              matchedWordsCount++;
              const wordWeight = wLower.length > 2 ? 20 : 5;
              score += wordWeight;
              
              if (nameLower.startsWith(wLower)) score += 10;
              if (new RegExp(`\\b${wLower}\\b`).test(nameLower)) score += 5;
            }
          }
          
          if (matchedWordsCount === words.length) {
            score += 100;
          }
          
          // Penalize all-lowercase names (likely generic/test records like 'fujairah')
          if (row.name === row.name.toLowerCase()) score -= 50;
          
          // Boost names that contain multiple words (proper company names)
          const wordCount = row.name.trim().split(/\s+/).length;
          if (wordCount >= 2) score += 10;
          
          score -= row.name.length * 0.1;
          return { row, score };
        });
        
        scored.sort((a: any, b: any) => b.score - a.score);
        candidates = scored.slice(0, 5).map((x: any) => x.row);
      }

      if (candidates.length === 0) {
        return res.status(400).json({ error: "this user is not exist in db" });
      } else if (body.confirmFirstCandidate && candidates.length > 0) {
        customerId = candidates[0].id;
        finalCustomerName = candidates[0].name;
      } else {
        return res.status(400).json({
          error: "disambiguation_required",
          candidates: candidates.map((c: any) => c.name),
          typedName: customerNameVal
        });
      }
    }

    // For dry-runs (customer verification only), short-circuit here after resolving customer
    if (body.dryRun && customerId > 0) {
      return res.status(200).json({
        success: true,
        dryRun: true,
        customerId,
        customerName: finalCustomerName
      });
    }

    const assigneeName = body.assignee || body.salesPerson;
    const reqName = body.requestedPerson;
    if (!assigneeName && !reqName) {
      return res.status(400).json({ error: "Level 1 Assignee and Requested Person cannot both be empty" });
    }

    const [maxRows]: any = await pool.query("SELECT MAX(customer_service_id) AS max_id FROM tbl_customer_services_beta");
    const nextId = (maxRows[0].max_id || 1000) + 1;

    const resolvedAssignee = assigneeName || reqName;
    const L1_assigned_to = await resolveUserIdByName(resolvedAssignee);
    const reqUserId = await resolveUserIdByName(reqName || "admin");

    let descVal = body.comment || body.description || "";
    const qtyVal = parseInt(body.newQty || body.quantity || "1") || 1;

    const payment = body.paymentOption || body.payment;
    let paymentVal = payment ? (payment.toLowerCase().replace(/\s+/g, "") === "applicable" ? "applicable" : "notapplicable") : null;

    const amount = body.projectValue || body.amount;
    let amountVal = null;
    if (amount === "same as old" || (typeof amount === "string" && amount.toLowerCase().includes("old"))) {
      amountVal = null;
      paymentVal = "applicable";
    } else {
      amountVal = (amount !== undefined && amount !== null && amount !== "") ? parseInt(amount) : null;
    }

    const payStatus = body.paymentStatus;
    const payStatusVal = payStatus ? (payStatus.toLowerCase().replace(/\s+/g, "") === "paid" ? "paid" : "notpaid") : null;
    const mapLinkVal = body.mapLink || body.link || null;

    let customerExpDate: any = null;
    let locatorPlanVal: any = null;
    let customerUsernameVal: any = null;
    try {
      const [locRows]: any = await pool.query(
        "SELECT customer_username, customer_expiry_date, locator_plan FROM customers_locator WHERE customer_name = ? LIMIT 1",
        [finalCustomerName]
      );
      if (locRows && locRows[0]) {
        customerUsernameVal = locRows[0].customer_username;
        customerExpDate = locRows[0].customer_expiry_date;
        locatorPlanVal = locRows[0].locator_plan;
      }
    } catch (err) {
      console.error("Failed to query customer_expiry_date/locator_plan from customers_locator:", err);
    }

    let contactPersonVal = body.contactPerson || body.contactName || null;
    let contactNumberVal = body.contactNumber || body.phone || null;
    let emailVal = body.email || null;
    let addressVal = body.address || null;
    let regionVal = body.region || null;
    let implementationTypeVal = body.implementationType || null;

    if (customerId > 0) {
      try {
        const [custRows]: any = await pool.query(
          "SELECT contact_name, phone, email, address, region, implementation_type FROM customers WHERE id = ? LIMIT 1",
          [customerId]
        );
        if (custRows && custRows[0]) {
          if (!contactPersonVal) contactPersonVal = custRows[0].contact_name;
          if (!contactNumberVal) contactNumberVal = custRows[0].phone;
          if (!emailVal) emailVal = custRows[0].email;
          if (!addressVal) addressVal = custRows[0].address;
          if (!regionVal) regionVal = custRows[0].region;
          if (!implementationTypeVal) implementationTypeVal = custRows[0].implementation_type;
        }
      } catch (err) {
        console.error("Failed to query contact details from customers table:", err);
      }
    }

    if (body.vehiclePlate) descVal += `\nVehicle Plate: ${body.vehiclePlate}`;
    if (body.accessories) descVal += `\naccessories: ${body.accessories}`;
    if (body.driverNumber) descVal += `\nDriver Number: ${body.driverNumber}`;
    if (body.preferredDateTime) descVal += `\nPreferred Date/Time: ${body.preferredDateTime}`;

    if (!body.dryRun) {
      await pool.query(
        `INSERT INTO tbl_customer_services_beta (
          customer_service_id, 
          customer_service_customer_id,
          customer_service_customer_name, 
          customer_service_customer_contact_name, 
          customer_service_customer_phone, 
          customer_service_customer_email, 
          customer_service_customer_address, 
          customer_service_address_map,
          region, 
          customer_service_customer_type, 
          customer_service_description, 
          customer_service_status, 
          customer_service_quantity, 
          customer_service_payment, 
          customer_service_amount, 
          customer_service_payment_status, 
          customer_service_L1_assigned_to,
          requested_by,
          customer_service_created_by,
          customer_service_customer_exp_date,
          locator_plan,
          customer_service_created_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          nextId,
          customerId,
          finalCustomerName,
          contactPersonVal,
          contactNumberVal,
          emailVal,
          addressVal,
          mapLinkVal,
          regionVal,
          implementationTypeVal || "LOCATOR",
          descVal,
          qtyVal,
          paymentVal,
          amountVal,
          payStatusVal,
          L1_assigned_to || 0,
          reqUserId || 0,
          reqUserId || 0,
          customerExpDate,
          locatorPlanVal
        ]
      );
    }

    return res.json({ 
      ...body,
      id: nextId, 
      customerUsername: customerUsernameVal || "", 
      contactPerson: contactPersonVal || "",
      contactNumber: contactNumberVal || "",
      email: emailVal || "",
      address: addressVal || "",
      region: regionVal || "",
      implementationType: implementationTypeVal || "LOCATOR",
      amount: (body.amount === "same as old" || (typeof body.amount === "string" && body.amount.toLowerCase().includes("old"))) ? "same as old" : amountVal,
      payment: paymentVal
    });
  } catch (err: any) {
    console.error("Create service request failed:", err);
    return res.status(500).json({ error: "Failed to create service ticket." });
  }
});

// Update Service Ticket
app.put("/api/services/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const body = req.body;
  try {
    const assigneeName = body.assignee || body.salesPerson || body.requestedPerson;
    const L1_assigned_to = assigneeName ? await resolveUserIdByName(assigneeName) : null;

    const queryParts = [];
    const queryParams = [];

    if (body.customerName) { queryParts.push("customer_service_customer_name = ?"); queryParams.push(body.customerName); }
    if (body.description) { queryParts.push("customer_service_description = ?"); queryParams.push(body.description); }
    if (body.status) {
      queryParts.push("customer_service_status = ?");
      queryParams.push(mapLeadStatusToDb(body.status));
    }
    if (body.quantity !== undefined) {
      queryParts.push("customer_service_quantity = ?");
      queryParams.push(body.quantity);
    }
    if (body.paymentOption || body.payment) {
      queryParts.push("customer_service_payment = ?");
      queryParams.push((body.paymentOption || body.payment || "applicable").toLowerCase().replace(/\s+/g, "") === "applicable" ? "applicable" : "notapplicable");
    }
    if (body.amount !== undefined) {
      queryParts.push("customer_service_amount = ?");
      queryParams.push(parseInt(body.amount || "0"));
    }
    if (body.paymentStatus) {
      queryParts.push("customer_service_payment_status = ?");
      queryParams.push((body.paymentStatus || "notpaid").toLowerCase().replace(/\s+/g, "") === "paid" ? "paid" : "notpaid");
    }
    if (L1_assigned_to !== null) {
      queryParts.push("customer_service_L1_assigned_to = ?");
      queryParams.push(L1_assigned_to);
    }

    if (queryParts.length > 0) {
      queryParams.push(id);
      await pool.query(
        `UPDATE tbl_customer_services_beta SET ${queryParts.join(", ")} WHERE customer_service_id = ?`,
        queryParams
      );
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error("Update service ticket failed:", err);
    return res.status(500).json({ error: "Failed to update service ticket." });
  }
});

// 7. Customers Search & Actions
app.get("/api/customers", async (req, res) => {
  const query = req.query.q || "";
  try {
    const [customerRows]: any = await pool.query(
      `SELECT id, name, contact_name AS contactName, phone, email, region, implementation_type AS implementationType, 
              vehicle_count AS vehicleCount, address 
       FROM customers 
       WHERE name LIKE ? OR contact_name LIKE ? 
       ORDER BY id DESC LIMIT 150`,
      [`%${query}%`, `%${query}%`]
    );

    const customerIds = customerRows.map((c: any) => c.id);
    let locatorMap: Record<number, any> = {};

    if (customerIds.length > 0) {
      const [locatorRows]: any = await pool.query(
        `SELECT customer_id, customer_username, locator_plan 
         FROM customers_locator 
         WHERE customer_id IN (${customerIds.map(() => "?").join(",")})`,
        customerIds
      );
      for (const row of locatorRows) {
        locatorMap[row.customer_id] = row;
      }
    }

    const mapped = customerRows.map((c: any) => {
      const loc = locatorMap[c.id] || {};
      return {
        id: c.id,
        name: c.name,
        contactName: c.contactName || "",
        phone: c.phone || "",
        email: c.email || "",
        region: c.region || "Dubai",
        implementationType: c.implementationType || "LOCATOR",
        vehicleCount: c.vehicleCount || 0,
        customerUsername: loc.customer_username || "",
        locatorPlan: loc.locator_plan || "Older Version",
        address: c.address || ""
      };
    });

    return res.json(mapped);
  } catch (err: any) {
    console.error("Customer search query failed:", err);
    return res.status(500).json({ error: "Failed to query customer directory." });
  }
});

app.put("/api/customers/:id", async (req, res) => {
  console.log(`[Read-Only Protection] Blocked update request on customers table for id: ${req.params.id}`);
  return res.json({ success: true });
});

// 8. Live AI Chat History & Neural Logs
app.get("/api/chat/history", (req, res) => {
  return res.json(localChatMessages);
});

app.post("/api/chat", async (req, res) => {
  const { message, aiMode, selectedChatTarget } = req.body;
  const target = selectedChatTarget || "admin";
  const channel = `${target}|ai:${aiMode || "gemini"}`;

  try {
    const userMsg = {
      role: "user",
      content: message,
      username: channel,
      timestamp: new Date().toISOString()
    };
    localChatMessages.push(userMsg);

    // AI Bot operations logic (similar to frontend client, but backend driven)
    let reply = "";
    const lowerMsg = String(message).toLowerCase();

    if (lowerMsg.includes("status") || lowerMsg.includes("ticket")) {
      const [openTkts]: any = await pool.query(
        "SELECT customer_service_id, customer_service_customer_name, customer_service_description FROM tbl_customer_services_beta WHERE customer_service_status = 'new' LIMIT 3"
      );
      if (openTkts.length > 0) {
        reply = `Retrieved active operations database tickets:\n\n` +
          openTkts.map((t: any) => `• [TKT-${t.customer_service_id}] **${t.customer_service_customer_name}** - ${t.customer_service_description.substring(0, 80)}...`).join("\n");
      } else {
        reply = "Telemetry audit report: All operations tickets are marked completed. Nominal status.";
      }
    } else if (lowerMsg.includes("stat") || lowerMsg.includes("count")) {
      const [leadsRes]: any = await pool.query("SELECT COUNT(*) AS total FROM tbl_customer_services_beta");
      const [custRes]: any = await pool.query("SELECT SUM(vehicle_count) AS total_vehicles FROM customers");
      reply = `### live Portal Statistics\n` +
        `• **Total Database Service Requests**: ${leadsRes[0].total} records\n` +
        `• **Tracked Vehicles**: ${custRes[0].total_vehicles || 0} active transponders`;
    } else if (lowerMsg.includes("hello") || lowerMsg.includes("hi") || lowerMsg.includes("hey")) {
      reply = `Greetings! I am the SynoHub neural fleet assistant. Connecting live to **${process.env.DB_NAME}**.\n\n` +
        `Ask me for status summaries, device logs, or system statistics.`;
    } else {
      reply = `Neural Command Parsed: "${message}". Standby for telemetry update. Portal is currently linked to host ${process.env.DB_HOST}.`;
    }

    const assistantMsg = {
      role: "assistant",
      content: reply,
      username: channel,
      timestamp: new Date().toISOString()
    };
    localChatMessages.push(assistantMsg);

    return res.json({ answer: reply });
  } catch (err: any) {
    console.error("Chat message processing failed:", err);
    return res.status(550).json({ error: "Failed to execute chat transaction." });
  }
});

app.get("/api/config", (req, res) => {
  return res.json({
    apiKey: process.env.GROQ_API_KEY || "",
    model: process.env.GROQ_MODEL || "llama-3.1-8b-instant"
  });
});

app.listen(PORT, () => {
  console.log(`SynoHub API Server running on port ${PORT}`);
});
