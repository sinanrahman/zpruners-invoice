# Zpruners Invoices

A local invoice editor with a Node.js and Express server, plain HTML/CSS/JavaScript and MongoDB persistence.

## Start

Use Node.js 22 or newer. From this directory in PowerShell:

```powershell
npm ci
Copy-Item .env.example .env
```

Edit `.env` and set `MONGODB_URI` to your MongoDB connection string. Keep the value quoted if it contains a literal #. For MongoDB Atlas, allow your machine's IP and use a database user with read/write access to `zpruners`, or change `MONGODB_DB` to your preferred database.

```powershell
npm start
```

Open http://127.0.0.1:3000. The home page lists saved invoices. Search by customer or invoice number, select **Open** to edit a saved invoice, or select **Create new** in the first column to start one. Enter your business and customer information, add line items, and use **Save invoice** to store the record in MongoDB.

**Preview invoice** shows the customer-facing version. **Print / PDF** opens your browser's print dialog, where you can select Save as PDF. Invoices automatically show the supplied Zpruners wordmark and a faint background pattern made from the brand icon. You can add a second logo in the editor.

The editor and PDF workflow also run with an empty MongoDB URI. Saving and searching saved invoices require a working connection. The server binds to localhost for single-user operation. Add authentication and HTTPS before putting it on a network.

Invoice numbers must be unique. INR is the initial currency and can be changed per invoice. Discounts apply to the subtotal, tax applies after discount, and shipping is added afterward. Payments reduce the balance and any overpayment is shown separately. Invoice calculation behavior is configurable in the source for your accounting requirements.

Feature reference: https://invoice-generator.com/developers
