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
    const [likeRows]: any = await pool.query(
      "SELECT user_id FROM tbl_users WHERE LOWER(user_name) LIKE ? OR LOWER(user_username) LIKE ? LIMIT 1",
      [`%${trimmed}%`, `%${trimmed}%`]
    );
    if (likeRows && likeRows[0]) {
      return likeRows[0].user_id;
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

    // 1. Case-insensitive exact match first
    const [exactMatches]: any = await pool.query(
      "SELECT id, name FROM customers WHERE LOWER(name) = ? LIMIT 1",
      [customerNameVal.toLowerCase()]
    );

    let customerId = 0;
    let finalCustomerName = customerNameVal;

    if (exactMatches && exactMatches.length > 0) {
      customerId = exactMatches[0].id;
      finalCustomerName = exactMatches[0].name;
    } else {
      // Clean query text: strip parenthetical text like "(Secret)"
      let cleaned = customerNameVal.replace(/\([^)]*\)/g, "").trim();
      
      // Strip legal suffixes / noise words so generic terms like "LLC" don't flood the query
      const noiseWords = [
        "llc", "l.l.c.", "l.l.c", "fzc", "fze", "co", "co.", "company", 
        "limited", "ltd", "ltd.", "inc", "est", "est.", "group", "branch", "services", "service"
      ];
      
      const words = cleaned
        .split(/[\s,.\-\/]+/)
        .map((w: string) => w.trim())
        .filter((w: string) => w.length >= 2 && !noiseWords.includes(w.toLowerCase()));

      // Core search words with stemmed variants (e.g., "gardens" -> "garden")
      const stemmedWords = (words.length > 0 ? words : [customerNameVal.trim()]).map(w => {
        const wLower = w.toLowerCase();
        if (wLower.endsWith("s") && wLower.length > 3) {
          return wLower.slice(0, -1);
        }
        return wLower;
      });

      let candidates: any[] = [];
      let candidatePool: any[] = [];

      // Query A: Search customers table by core stemmed words (AND clauses)
      if (stemmedWords.length > 0) {
        const clauses = stemmedWords.map(() => "(LOWER(name) LIKE ? OR LOWER(name) LIKE ?)").join(" AND ");
        const params: string[] = [];
        for (const sw of stemmedWords) {
          params.push(`%${sw}%`, `%${sw}s%`);
        }

        try {
          const [andRows]: any = await pool.query(
            `SELECT id, name FROM customers WHERE ${clauses} LIMIT 50`,
            params
          );
          candidatePool = andRows || [];
        } catch (err) {
          console.error("Fuzzy AND query error:", err);
        }

        // Query B: If less than 5 rows, search with OR clauses for stemmed words
        if (candidatePool.length < 5) {
          const orClauses = stemmedWords.map(() => "(LOWER(name) LIKE ? OR LOWER(name) LIKE ?)").join(" OR ");
          const params: string[] = [];
          for (const sw of stemmedWords) {
            params.push(`%${sw}%`, `%${sw}s%`);
          }
          try {
            const [orRows]: any = await pool.query(
              `SELECT id, name FROM customers WHERE ${orClauses} LIMIT 100`,
              params
            );

            const seenIds = new Set(candidatePool.map((r: any) => r.id));
            for (const row of (orRows || [])) {
              if (!seenIds.has(row.id)) {
                candidatePool.push(row);
                seenIds.add(row.id);
              }
            }
          } catch (err) {
            console.error("Fuzzy OR query error:", err);
          }
        }
      }

      // Query C: Search customers_locator table by customer_username or customer_name
      try {
        const compactTyped = customerNameVal.replace(/[\s\-_]+/g, "").toLowerCase();
        const [locRows]: any = await pool.query(
          "SELECT customer_name FROM customers_locator WHERE LOWER(customer_username) LIKE ? OR LOWER(customer_name) LIKE ? LIMIT 10",
          [`%${compactTyped}%`, `%${stemmedWords[0] || customerNameVal}%`]
        );
        if (locRows && locRows.length > 0) {
          const locNames = locRows.map((r: any) => r.customer_name);
          const [locCustRows]: any = await pool.query(
            "SELECT id, name FROM customers WHERE name IN (?)",
            [locNames]
          );
          const seenIds = new Set(candidatePool.map((r: any) => r.id));
          for (const row of (locCustRows || [])) {
            if (!seenIds.has(row.id)) {
              candidatePool.push(row);
              seenIds.add(row.id);
            }
          }
        }
      } catch (locErr) {
        console.error("Locator customer search error:", locErr);
      }

      // Score candidates
      const scored = candidatePool.map((row: any) => {
        const nameLower = row.name.toLowerCase();
        let score = 0;
        let matchedCount = 0;

        for (let i = 0; i < words.length; i++) {
          const wOriginal = words[i].toLowerCase();
          const wStemmed = stemmedWords[i];

          if (nameLower.includes(wOriginal) || nameLower.includes(wStemmed)) {
            matchedCount++;
            score += 50;

            if (nameLower.startsWith(wOriginal) || nameLower.startsWith(wStemmed)) {
              score += 100;
            }
          }
        }

        // If ALL core non-noise words match (e.g. both 'secret' and 'garden'), HUGE BOOST!
        if (words.length > 0 && matchedCount === words.length) {
          score += 500;
        }

        // Penalize all-lowercase names ('fujairah' junk)
        if (row.name === row.name.toLowerCase()) {
          score -= 100;
        }

        return { row, score };
      });

      scored.sort((a: any, b: any) => b.score - a.score);

      // Filter candidates with a positive score
      const validScored = scored.filter((x: any) => x.score > 0);
      candidates = validScored.slice(0, 5).map((x: any) => x.row);

      // Require confirmation for fuzzy matches unless explicitly confirmed via confirmFirstCandidate
      if (body.confirmFirstCandidate && candidates.length > 0) {
        customerId = candidates[0].id;
        finalCustomerName = candidates[0].name;
      } else if (candidates.length === 0) {
        return res.status(400).json({ error: "this user is not exist in db" });
      } else {
        return res.status(400).json({
          error: "disambiguation_required",
          candidates: candidates.map((c: any) => c.name),
          typedName: customerNameVal
        });
      }
    }

    let contactPersonVal = body.contactPerson || body.contactName || null;
    let contactNumberVal = body.contactNumber || body.phone || null;
    let customerPhoneVal: string | null = null;
    let emailVal = body.email || null;
    let addressVal = body.address || null;
    let regionVal = body.region || null;
    let implementationTypeVal = body.implementationType || null;
    let salesPersonVal = body.assignee || body.salesPerson || null;
    let customerUsernameVal: any = null;

    if (customerId > 0) {
      try {
        const [custRows]: any = await pool.query(
          "SELECT contact_name, phone, email, address, region, implementation_type, salesPerson FROM customers WHERE id = ? LIMIT 1",
          [customerId]
        );
        if (custRows && custRows[0]) {
          customerPhoneVal = custRows[0].phone || null;
          if (!contactPersonVal) contactPersonVal = custRows[0].contact_name;
          if (!contactNumberVal) contactNumberVal = custRows[0].phone;
          if (!emailVal) emailVal = custRows[0].email;
          if (!addressVal) addressVal = custRows[0].address;
          if (!regionVal) regionVal = custRows[0].region;
          if (!implementationTypeVal) implementationTypeVal = custRows[0].implementation_type;
          if (!salesPersonVal && custRows[0].salesPerson) {
            salesPersonVal = userIdToNameMap[custRows[0].salesPerson] || null;
          }
        }
      } catch (err) {
        console.error("Failed to query contact details from customers table:", err);
      }
    }

    try {
      const [locRows]: any = await pool.query(
        "SELECT customer_username FROM customers_locator WHERE customer_name = ? LIMIT 1",
        [finalCustomerName]
      );
      if (locRows && locRows[0]) {
        customerUsernameVal = locRows[0].customer_username;
      }
    } catch (err) {
      console.error("Failed to query customer_username from customers_locator:", err);
    }

    // Clean up description if customer name is trailing at the end (e.g. "dash cam not working for - Garlic Restaurant")
    let rawDesc = (body.comment || body.description || "").trim();
    if (rawDesc && finalCustomerName) {
      const escapedCust = finalCustomerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\s*(?:for\\s*[-:]*\\s*${escapedCust}|[-:]*\\s*${escapedCust})$`, 'i');
      rawDesc = rawDesc.replace(re, '').trim();
    }

    // For dry-runs (customer verification only), short-circuit here after resolving customer and contact defaults
    if (body.dryRun && customerId > 0) {
      return res.status(200).json({
        success: true,
        dryRun: true,
        customerId,
        customerName: finalCustomerName,
        customerUsername: customerUsernameVal,
        customerPhone: customerPhoneVal || contactNumberVal,
        contactPerson: contactPersonVal,
        contactNumber: contactNumberVal,
        email: emailVal,
        address: addressVal,
        region: regionVal,
        implementationType: implementationTypeVal,
        assignee: salesPersonVal,
        description: rawDesc,
        quantity: parseInt(body.newQty || body.quantity || "1") || 1,
        vehiclePlate: body.vehiclePlate || null,
        accessories: body.accessories || null,
        driverNumber: body.driverNumber || null,
        preferredDateTime: body.preferredDateTime || null,
        requestedPerson: body.requestedPerson || "admin",
        amount: body.projectValue || body.amount || null,
        payment: body.paymentOption || body.payment || "Applicable",
        link: body.mapLink || body.link || null
      });
    }

    const assigneeName = salesPersonVal || body.assignee || body.salesPerson;
    const reqName = body.requestedPerson;
    if (!assigneeName && !reqName) {
      return res.status(400).json({ error: "Level 1 Assignee and Requested Person cannot both be empty" });
    }

    const [maxRows]: any = await pool.query("SELECT MAX(customer_service_id) AS max_id FROM tbl_customer_services_beta");
    const nextId = (maxRows[0].max_id || 1000) + 1;

    const resolvedAssignee = assigneeName || reqName;
    const L1_assigned_to = await resolveUserIdByName(resolvedAssignee);
    const reqUserId = await resolveUserIdByName(reqName || "admin");

    let descVal = rawDesc;
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
    try {
      const [locRows]: any = await pool.query(
        "SELECT customer_username, customer_expiry_date, locator_plan FROM customers_locator WHERE customer_name = ? LIMIT 1",
        [finalCustomerName]
      );
      if (locRows && locRows[0]) {
        customerExpDate = locRows[0].customer_expiry_date;
        locatorPlanVal = locRows[0].locator_plan;
      }
    } catch (err) {
      console.error("Failed to query customer_expiry_date/locator_plan from customers_locator:", err);
    }

    if (body.vehiclePlate) descVal += `\nVehicle Plate: ${body.vehiclePlate}`;
    if (body.accessories) descVal += `\naccessories: ${body.accessories}`;
    if (body.driverNumber) descVal += `\nDriver Number: ${body.driverNumber}`;
    if (body.preferredDateTime) descVal += `\nPreferred Date/Time: ${body.preferredDateTime}`;
    if (contactPersonVal || contactNumberVal) {
      const contactDetail = [contactPersonVal, contactNumberVal].filter(Boolean).join(" - ");
      if (contactDetail && !descVal.toLowerCase().includes(contactDetail.toLowerCase()) && (!contactNumberVal || !descVal.includes(contactNumberVal))) {
        descVal += `\nContact: ${contactDetail}`;
      }
    }

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
      customerPhone: customerPhoneVal || contactNumberVal || "",
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

    const [existingRows]: any = await pool.query(
      "SELECT * FROM tbl_customer_services_beta WHERE customer_service_id = ? LIMIT 1",
      [id]
    );

    if (!existingRows || existingRows.length === 0) {
      return res.status(404).json({ error: "Service ticket not found" });
    }

    const existing = existingRows[0];
    let descVal = body.description || existing.customer_service_description || "";

    if (body.vehiclePlate) {
      if (/Vehicle Plate:\s*.*/i.test(descVal)) {
        descVal = descVal.replace(/Vehicle Plate:\s*.*/i, `Vehicle Plate: ${body.vehiclePlate}`);
      } else {
        descVal += `\nVehicle Plate: ${body.vehiclePlate}`;
      }
    }
    if (body.accessories) {
      if (/accessories:\s*.*/i.test(descVal)) {
        descVal = descVal.replace(/accessories:\s*.*/i, `accessories: ${body.accessories}`);
      } else {
        descVal += `\naccessories: ${body.accessories}`;
      }
    }
    if (body.driverNumber) {
      if (/Driver Number:\s*.*/i.test(descVal)) {
        descVal = descVal.replace(/Driver Number:\s*.*/i, `Driver Number: ${body.driverNumber}`);
      } else {
        descVal += `\nDriver Number: ${body.driverNumber}`;
      }
    }
    if (body.preferredDateTime) {
      if (/Preferred Date\/Time:\s*.*/i.test(descVal)) {
        descVal = descVal.replace(/Preferred Date\/Time:\s*.*/i, `Preferred Date/Time: ${body.preferredDateTime}`);
      } else {
        descVal += `\nPreferred Date/Time: ${body.preferredDateTime}`;
      }
    }
    if (body.contactPerson || body.contactNumber) {
      const cPerson = body.contactPerson || body.contactName;
      const cNumber = body.contactNumber || body.phone;
      const contactDetail = [cPerson, cNumber].filter(Boolean).join(" - ");
      if (contactDetail) {
        if (/Contact:\s*.*/i.test(descVal)) {
          descVal = descVal.replace(/Contact:\s*.*/i, `Contact: ${contactDetail}`);
        } else if (!descVal.toLowerCase().includes(contactDetail.toLowerCase()) && (!cNumber || !descVal.includes(cNumber))) {
          descVal += `\nContact: ${contactDetail}`;
        }
      }
    }

    const queryParts = [];
    const queryParams = [];

    if (body.customerName) { queryParts.push("customer_service_customer_name = ?"); queryParams.push(body.customerName); }
    if (body.contactPerson || body.contactName) { queryParts.push("customer_service_customer_contact_name = ?"); queryParams.push(body.contactPerson || body.contactName); }
    if (body.contactNumber || body.phone) { queryParts.push("customer_service_customer_phone = ?"); queryParams.push(body.contactNumber || body.phone); }
    if (descVal) { queryParts.push("customer_service_description = ?"); queryParams.push(descVal); }
    if (body.status) {
      queryParts.push("customer_service_status = ?");
      queryParams.push(mapLeadStatusToDb(body.status));
    }
    if (body.quantity !== undefined && body.quantity !== null) {
      const parsedQty = parseInt(String(body.quantity));
      if (!isNaN(parsedQty)) {
        queryParts.push("customer_service_quantity = ?");
        queryParams.push(parsedQty);
      }
    }
    if (body.paymentOption || body.payment) {
      queryParts.push("customer_service_payment = ?");
      queryParams.push((body.paymentOption || body.payment || "applicable").toLowerCase().replace(/\s+/g, "") === "applicable" ? "applicable" : "notapplicable");
    }
    if (body.amount !== undefined && body.amount !== null) {
      const amount = body.amount;
      const isOld = amount === "same as old" || (typeof amount === "string" && amount.toLowerCase().includes("old"));
      const parsedAmount = isOld ? null : parseInt(String(amount));
      queryParts.push("customer_service_amount = ?");
      queryParams.push(isOld || isNaN(parsedAmount) ? null : parsedAmount);
    }
    if (body.paymentStatus) {
      queryParts.push("customer_service_payment_status = ?");
      queryParams.push((body.paymentStatus || "notpaid").toLowerCase().replace(/\s+/g, "") === "paid" ? "paid" : "notpaid");
    }
    if (L1_assigned_to !== null && L1_assigned_to > 0) {
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

    const [updatedRows]: any = await pool.query(
      "SELECT * FROM tbl_customer_services_beta WHERE customer_service_id = ? LIMIT 1",
      [id]
    );
    const updated = updatedRows[0] || existing;

    let customerUsernameVal = "";
    let customerPhoneVal = "";
    try {
      const [locRows]: any = await pool.query(
        "SELECT customer_username FROM customers_locator WHERE customer_name = ? LIMIT 1",
        [updated.customer_service_customer_name]
      );
      if (locRows && locRows[0]) {
        customerUsernameVal = locRows[0].customer_username;
      }
    } catch (err) {
      console.error("Failed to query customer_username:", err);
    }

    try {
      const [custRows]: any = await pool.query(
        "SELECT phone FROM customers WHERE name = ? LIMIT 1",
        [updated.customer_service_customer_name]
      );
      if (custRows && custRows[0]) {
        customerPhoneVal = custRows[0].phone || "";
      }
    } catch (err) {
      console.error("Failed to query customer phone:", err);
    }

    const extractedPlate = descVal.match(/Vehicle Plate:\s*(.*)/i)?.[1]?.trim() || body.vehiclePlate || null;
    const extractedDriver = descVal.match(/Driver Number:\s*(.*)/i)?.[1]?.trim() || body.driverNumber || null;
    const extractedAccessories = descVal.match(/accessories:\s*(.*)/i)?.[1]?.trim() || body.accessories || null;

    return res.json({
      success: true,
      id: updated.customer_service_id,
      customerName: updated.customer_service_customer_name,
      customerUsername: customerUsernameVal,
      customerPhone: customerPhoneVal || updated.customer_service_customer_phone || "",
      contactPerson: updated.customer_service_customer_contact_name,
      contactNumber: updated.customer_service_customer_phone,
      driverNumber: extractedDriver,
      implementationType: updated.customer_service_customer_type,
      quantity: updated.customer_service_quantity,
      vehiclePlate: extractedPlate,
      region: updated.region,
      description: descVal,
      accessories: extractedAccessories,
      assignee: assigneeName || userIdToNameMap[updated.customer_service_L1_assigned_to] || "",
      requestedPerson: userIdToNameMap[updated.requested_by] || body.requestedPerson || "admin",
      amount: (body.amount === "same as old" || (typeof body.amount === "string" && body.amount.toLowerCase().includes("old"))) ? "same as old" : updated.customer_service_amount
    });
  } catch (err: any) {
    console.error("Update service ticket failed:", err);
    return res.status(500).json({ error: "Failed to update service ticket." });
  }
});

// Get latest service ticket record
app.get("/api/services/latest", async (req, res) => {
  try {
    const [rows]: any = await pool.query(
      "SELECT * FROM tbl_customer_services_beta ORDER BY customer_service_id DESC LIMIT 1"
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: "No service tickets found" });
    }
    return res.json(rows[0]);
  } catch (err: any) {
    console.error("Get latest service ticket failed:", err);
    return res.status(500).json({ error: "Failed to fetch latest service ticket." });
  }
});

// Delete / Undo Service Ticket
app.delete("/api/services/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await pool.query(
      "DELETE FROM tbl_customer_services_beta WHERE customer_service_id = ?",
      [id]
    );
    return res.json({ success: true, deletedId: id });
  } catch (err: any) {
    console.error("Delete service ticket failed:", err);
    return res.status(500).json({ error: "Failed to delete service ticket." });
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
