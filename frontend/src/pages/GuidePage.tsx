import { useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { REQUEST_STATUS } from '@/features/itemRequests/api'
import { APPROVAL_STATUS, PPB_AMEND, PPB_LINE_STATUS } from '@/features/ppb/api'
import { RI_SOURCE } from '@/features/ri/api'
import { SYNC_SCHEDULE } from '@/components/AccurateDataNote'
import { PageHeader } from '@/components/PageHeader'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Item = { term: string; text: ReactNode }
type Section = { id: string; title: string; intro?: string; items: Item[] }

/** What each Request Barang status means for whoever reads it. */
const REQUEST_HINT: Record<string, string> = {
  MENUNGGU: 'New request, waiting for the warehouse admin to match its items with the Product Master.',
  DIPROSES: 'Some items are already matched by the warehouse admin.',
  PERLU_PERBAIKAN: 'Returned by Manager / Director: the warehouse admin verifies again and resends.',
  APPROVAL_MANAGER: 'Waiting for Manager approval.',
  APPROVAL_DIREKTUR: 'Waiting for Director approval.',
  DISIAPKAN: 'Approved: the warehouse prepares items from stock (Delivery Order), then handover.',
  SIAP_DISERAHKAN: 'The items are prepared; the requester (or a representative) can collect them at the warehouse.',
  DIPENUHI_SEBAGIAN: 'Some items are handed over, the rest still in process.',
  MENUNGGU_PENGADAAN: 'Not enough stock: the shortage goes to Draft Purchase Request to be purchased.',
  MENUNGGU_BARANG: 'The item is being purchased (Purchase Request / PO), handed over after the Receipt arrives.',
  SELESAI: 'All items handed over.',
  DITOLAK: 'Request rejected.',
  DIBATALKAN: 'Request cancelled.',
}

const APPROVAL_HINT: Record<string, string> = {
  MENUNGGU: 'STOCKWISE Purchase Request waiting for Manager (Accurate Purchase Request: waiting for approval before PO).',
  MENUNGGU_DIREKTUR: 'Approved by Manager, waiting for Director.',
  DISETUJUI: 'May be purchased: its items go to Draft PO.',
  DITOLAK: 'Not purchased.',
  DIKEMBALIKAN: 'The admin revises the Purchase Request and submits it again.',
  TIDAK_PERLU: 'Purchase Request made before the approval rule applied.',
}

const RI_HINT: Record<string, string> = {
  PO: 'Items from a STOCKWISE PO: find the PO, fill the quantity that arrived per item (partial is allowed), and a proof photo for each. Leave items that have not arrived empty; they can go on the next Receipt.',
  BEKAS: 'Used items returning from a Delivery Order marked "Return used item". Used Item Return Tracking becomes Clear automatically; used items do not add to stock.',
  MANUAL: 'Any item, not tied to a PO or used-item return. If its code is in the Product Master, stock increases.',
  ACCURATE: 'Receipt made directly in Accurate without a PO.',
}

const SECTIONS: Section[] = [
  {
    id: 'alur', title: 'Workflow', items: [
      { term: 'Item Request', text: 'An employee writes the items needed → the warehouse admin matches them to the Product Master (verification) → Manager → Director approve → the warehouse prepares from stock (Delivery Order) → handover with photo & signature. Any stock shortage goes to Draft Purchase Request automatically.' },
      { term: 'Procurement', text: 'Draft Purchase Request → submitted as Purchase Request → approved by Manager then Director → items go to Draft PO → compare vendor prices, make a PO (one PO = one vendor) → approved by Director → upload purchase proof → arrival recorded through Receipt.' },
      { term: 'Manual Delivery Order', text: 'Closed. Goods leave the warehouse only through Item Request → Delivery Order. The warehouse admin can make an Item Request for someone else (Create Item Request › Request for someone else: a person from Data Pekerja, or a name); it then goes through verification and approval like any request. Manual Delivery Orders already submitted are still approved or rejected as before.' },
      { term: 'Purchase return', text: 'Created from a Receipt → ship the items to the vendor (shipping proof photo) → mark done when the vendor settles it (replacement / bill deduction).' },
      { term: 'Stock opname', text: '1. Schedule: the admin selects the warehouse & items to count. 2. Count: the counter fills in the physical quantity (system stock is hidden); items with a difference must have a note. 3. Review: the warehouse admin approves, rejects, or asks for a recount. 4. Done: approved differences adjust the stock automatically.' },
    ],
  },
  {
    id: 'manufacturing', title: 'Manufacturing (BoM & Manufacturing Order)',
    intro: 'Separate from the Tracking › Manufacturing sheet (MA/MJ numbers), which stays as it is.',
    items: [
      { term: 'Bill of Materials (BoM)', text: 'What 1 finished product is made of, each component in its own Base UOM (e.g. 1 Panel Control = 5 MTR cable + 8 PCS bolt). Draft → Active → Archived. Only one revision per product is active; activating a new one archives the old. An active BoM is not edited: make a New revision. A product may not contain itself, directly or through another BoM.' },
      { term: 'Manufacturing Order (MO)', text: 'Draft → Confirmed → In Progress → To Close → Done (or Cancelled). The MO copies the BoM when it is created, so a later BoM change never changes an existing MO. Required = qty per unit × planned quantity.' },
      { term: 'Confirm', text: 'Locks the plan. The MO holds no stock itself: use Request from warehouse (Warehouse documents) to make an Item Request for the components still to get; it goes through verification and approval, then the warehouse hands them over with a Delivery Order.' },
      { term: 'Availability', text: 'On hand, asked with Item Requests, handed over by the warehouse (Delivery Order) and shortage, from STOCKWISE stock (aligned to Accurate at every sync). A shortage can be sent to Draft Purchase Request; it is bought through the normal Purchase Request → PO → Receipt flow.' },
      { term: 'Recording (In Progress)', text: 'Consumption, finished output and scrap are recorded as they happen; partial entries are fine. Another unit (e.g. 0.5 ROL of cable = 50 MTR) works only when the item has that ratio in Master UOM; the ratio is frozen on the entry. A quantity that does not fit the stock’s 2 decimals is refused, never rounded. More than planned, or an item outside the BoM, needs a reason and the validate permission. A wrong entry is voided (kept, struck through), not deleted.' },
      { term: 'Scrap', text: 'Scrap of a component is recorded on the MO (it was already handed over by the warehouse). Scrap of the finished product is rejected output: it never comes into the warehouse.' },
      { term: 'Validate (To Close → Done)', text: 'Checks the warehouse door: every component consumed or scrapped was handed over by the warehouse (Item Request → Delivery Order), and the good output came in with a Receipt linked under Warehouse documents (make a manual Receipt of the finished product, then Link it). The MO itself moves no stock; if anything is missing it says what.' },
      { term: 'Accurate', text: 'The stock moves through the Delivery Order and the Receipt, which follow their own Accurate reconciliation, so a new MO needs no Accurate marking. Only MOs validated before this rule (they moved stock themselves) still show Mark as entered in Accurate.' },
      { term: 'Cancel / Reverse', text: 'Before Done: Cancel (a reason after Draft). A Done MO is not reversed: correct it with the warehouse documents (return the goods with a Receipt, or ask more with an Item Request). Only MOs validated before this rule can still be reversed.' },
      { term: 'Production History', text: 'Production summary, material consumption (required vs consumed vs scrap), finished goods output, scrap with reasons, and traceability: an item → the MOs that produced or used it → the stock movements they posted. No cost report: STOCKWISE has no reliable item cost.' },
    ],
  },
  {
    id: 'documents', title: 'Related documents, Chatter, Activities & Audit',
    intro: 'On Item Request, Delivery Order, Draft Purchase Request, Purchase Request, Purchase Order, Receipt and Return. They only show and record; they never change the document, its approval or the stock.',
    items: [
      { term: 'Smart buttons', text: 'The buttons under the document title count the documents linked to it (e.g. an Item Request → its Delivery Orders and Draft Purchase Requests; a Purchase Order → its Purchase Requests, Receipts and Returns). One document opens directly, several open a list. You only see the kinds of documents your role may open.' },
      { term: 'Send message', text: 'Seen by everyone who can open the document, the requester of an Item Request too. Up to 5 files of 10 MB each. You may edit or delete only your own message; a deleted message shows as deleted and the change is kept in the audit trail.' },
      { term: 'Log note', text: 'An internal note for the staff who handle the document (not shown to the requester). Use it for internal information about the document.' },
      { term: 'Activities', text: 'Planned activities show what has to happen next: the System ones come from the document status (e.g. "Approve the request · Manager") and disappear by themselves when the document moves on. Activity schedules a follow-up for a person with a type and due date; that person is notified, sees it in the To-Do, and marks it Done. Only its creator may cancel it.' },
      { term: 'Changes / Audit trail', text: 'Every change a user makes to the document (status, quantities, prices, vendor, dates …) is recorded with the value before and after, who, when and the reason if one was given. Changes brought by the Accurate sync are not listed. The audit trail cannot be edited or deleted.' },
    ],
  },
  {
    id: 'disassembly', title: 'Disassembly (taking a product apart)',
    intro: 'The opposite direction of Manufacturing: one product is taken apart into the components of its active BoM (e.g. 1 BOX ATK Toolkit = 2 PCS pen + 2 PCS pencil + 1 PCS eraser + 1 PCS book). It uses the same BoM, the same stock and the same Accurate rule as Manufacturing.',
    items: [
      { term: 'Manufacturing vs Disassembly', text: 'Manufacturing: several components in, one product out. Disassembly: one product out, several components in. Both move stock only at Validate, through the same stock ledger.' },
      { term: 'New Disassembly Order', text: 'Pick a product that has an active BoM, the quantity to take apart (Base UOM of the product), the source warehouse and, if needed, another warehouse for the components. The expected components are shown right away (per unit × quantity). The order keeps its own copy of the BoM, so a later BoM change never changes it. A unit whose Master UOM rounding is 1 cannot be split (no 0.5 BOX).' },
      { term: 'Status', text: 'Draft → Confirmed → In Progress → To Close → Done, or Cancelled. Every step is checked on the server; a step that does not fit the status is refused.' },
      { term: 'Confirm', text: 'Locks the plan (refused when the source warehouse has not enough free stock). Then Request from warehouse makes an Item Request for the product; after verification and approval the warehouse hands it over with a Delivery Order.' },
      { term: 'Record the results (In Progress)', text: 'For each component record what came out: Good result (comes into the warehouse with a Receipt), Scrap (damaged, reason required) or Missing (not found, reason required). Record as good on the Components tab fills in what is not recorded yet. Another unit works only when the item has that ratio in Master UOM; the ratio is frozen on the entry. More than the BoM, or an item outside the BoM, needs a reason and the validate permission. A wrong entry is voided (kept, struck through), not deleted.' },
      { term: 'Mark as finished', text: 'Fill in how much was really taken apart (at most the plan). Every component must then be fully recorded: good + scrap + missing at least per unit × that quantity. Nothing is assumed from the BoM. More than that can be finished only by someone with the validate permission.' },
      { term: 'Validate (To Close → Done)', text: 'Checks the warehouse door: the product taken apart was handed over by the warehouse (Delivery Order) and every good component came in with a Receipt linked under Warehouse documents (one manual Receipt per component). Scrap and missing never come in. The order itself moves no stock.' },
      { term: 'Cancel / Reverse', text: 'Before Done: Cancel (a reason after Draft). A Done order is corrected with warehouse documents, not reversed; only orders validated before this rule can still be reversed (refused when a recovered component was used, or once marked as entered in Accurate).' },
      { term: 'Accurate', text: 'The stock moves through the Delivery Order and the Receipts, which follow their own Accurate reconciliation; only orders validated before this rule still show Mark as entered in Accurate.' },
      { term: 'Permissions', text: 'View: see orders and history. Create: new / edit drafts. Confirm: reserve the product. Record: start, record results, finish, reopen. Validate: post to stock, allow results beyond the BoM, mark as entered in Accurate. Cancel: cancel and reverse. Default: Admin Gudang all, Lapangan Gudang view + record, BOS view.' },
      { term: 'Disassembly History', text: 'Validated orders per period with good, scrap and missing per component; filter by the product or a component. The movements also appear in each item’s Moves History with the DSA number.' },
    ],
  },
  {
    id: 'cara', title: 'How to use the pages', items: [
      { term: 'Analytics (Dashboard › Analytics)', text: 'All charts on one page, separate from the To-Do: Stock Condition, Procurement, Tracking and Stock Card. Use the bar at the top to jump between sections; Download PDF or Print saves the whole page.' },
      { term: 'My To-Do (Dashboard › To-Do)', text: 'Under the greeting: one card per kind of work waiting for you (only what your role may do), each row opens its document, and the card empties by itself when the document moves on. Ticking a row never changes a transaction. My Notes holds your private sticky notes (only you see them): title, text, checklist, color, pin, done, and an optional reminder. Drag a card by its six-dot grip to move it, drag the bottom-right corner to resize it (or focus it and use the arrow keys), hide it with the eye, bring it back with Add card, and Reset layout to start over. Your layout is saved on the server for your account only.' },
      { term: 'Tracking tables', text: 'Type directly in the table; it saves automatically. A blue row is a new row: fill it and press Enter.' },
      { term: 'STPP', text: 'Fill in Return Mark to mark the tool as returned automatically (PASSIVE).' },
      { term: 'Stock Card', text: 'Fill in the date, remarks, and In / Out; or type the Balance, and In / Out is calculated. Press Enter to save.' },
      { term: 'Delivery Order / Purchase Request columns in Physical Inventory', text: 'Delivery Order / Purchase Request rows per item in the selected period. Click the number to see the list.' },
      { term: 'Physical Inventory Differences', text: 'Items whose quantity differs from stock must have a note. If any is missed, the system names the item code.' },
      { term: 'Request Verification', text: 'Select an item in the Requested items table, then match it with the Product Master. An item with serial numbers (SN, e.g. tyres) needs its serials picked here, one per unit given from stock; they are held for this request and filled in at the handover.' },
      { term: 'Serial numbers of an item', text: 'In the Product Master, click the purple SN badge next to the code: every serial of the item, whether it is in stock, held by an Item Request (with its number), or out (with the Delivery Order).' },
      { term: 'Approval', text: 'Approve, reject, or click Revise if something is not right; the document creator corrects it. The approver does not change quantities.' },
      { term: 'Approved Purchase Request Items', text: 'Items from approved Purchase Requests. Tick the items that need prices, then move them to Price Quotation.' },
      { term: 'Price Quotation', text: 'One Price Matrix for every role: items in rows, vendors in columns. Purchasing types each vendor price in its cell (Quotes adds availability, ETA, and notes), then submits to the Director. The Director only clicks a price cell to pick that vendor; the picked cell turns green with the Director Pick tag and is locked. To change a locked pick, the Director clicks another quoted cell or Return (back to purchasing) and must write a reason of at least 5 characters; every change is in the item Log. Purchasing then ticks picked items and creates the Draft PO from the same matrix. Once the item is in a PO it can only be read.' },
      { term: 'Purchase Order To do', text: 'The dashboard lists the items ready to process. Tick items, add any vendors, then Add to Draft PO. Draft PO shows them as a table with items in rows and vendors in columns; type each price where the item and vendor cross. Then Submit to Director: the Director picks one vendor per item as usual.' },
      { term: 'Draft PO', text: 'A matrix of items (rows) and vendors (columns) with prices. Tick items; the vendor follows the Director pick automatically. One PO per vendor; items from several vendors become several POs.' },
      { term: 'Not Director Pick', text: 'Another vendor that has quoted may be selected in Draft PO. At approval that item gets a color block and the Not Director Pick tag with the original pick.' },
      { term: 'Price history', text: 'Click the Update date on a price to see the last 3 price updates from purchasing.' },
      { term: 'Category prefix', text: 'The first three letters of the item code. Items with that prefix go into their main category automatically at Accurate sync.' },
      { term: 'Important Request Deadline', text: 'Automatic from priority (Low 3 days, Medium 2, High 1, Urgent today) and can be changed.' },
      { term: 'Form Links & QR', text: 'Scan the QR with a phone camera to open the form; post it at the warehouse or send it to a WhatsApp group. If a link leaks, delete it and create a new one.' },
      { term: 'Stock Card Link', text: 'Delete a link to revoke its access. Links only open from a network that reaches the STOCKWISE server.' },
      { term: 'Lending Status', text: 'Est. Loan / Out Mark: ON LOAN. Mark / Return Date: RETURNED.' },
      { term: 'External Borrow Status', text: 'In Mark: ON LOAN. Out Mark: PAID.' },
      { term: 'Maintenance Status', text: 'Request: REQUESTED. Delivery Order No.: ON-GOING. After Photo and Finish Date: COMPLETED. Button + adds a Sub SPK.' },
      { term: 'Manufacturing Status', text: 'Product, serial, and process: REQUESTED. Delivery Order No.: ON-GOING. Photo, Finish Date, and Receipt No.: COMPLETED. Button + adds a unit, +Sub adds a Sub.' },
      { term: 'Used Items', text: 'The Spare Part sheet records surplus / shortage per component (minus means short); Other Spare Part is per item with out and receipt photos.' },
      { term: 'Accurate Online', text: 'The list updates automatically every 15 seconds. The Accurate login name is only available with the Firebird production account. Disconnecting applies only to connections to the Accurate database and is always logged.' },
      { term: 'Select columns', text: 'The Columns button sets the visible columns. Hidden columns are left out of export and print.' },
      { term: 'Auto Refresh', text: 'Super Admin only (Settings · Auto Refresh): how often every open tab picks up what other accounts changed, from 3 to 600 seconds. Only the data that changed reloads, not the whole page. A shorter interval loads the server more for every open tab; if the app feels slow, lengthen it. When off, a change shows after reloading the page or through the slower background updates.' },
      { term: 'Update Alert', text: 'Super Admin only (Settings · Update Alert): a popup in the middle of every user\'s screen. The thumb closes it and records who agreed; closing with X does not. Click the Thumbs up count on the page to see who and when. Once only: shown until the user closes it, then never again. Every login: once after each sign-in; users already signed in get it at their next sign-in. Repeat: shown at once, then again the set time after the user closes it. Active from / until limits the period (empty means no limit). Closed by counts the users who have closed it.' },
    ],
  },
  {
    id: 'request', title: 'Item Request Status',
    items: Object.entries(REQUEST_STATUS).map(([k, v]) => ({ term: v.label, text: REQUEST_HINT[k] ?? '' })),
  },
  {
    id: 'ppb', title: 'Status Purchase Request', intro: 'Each item row status follows Accurate. Amend shows beside it when the purchase changed / was cancelled (e.g. Amend + Requested).',
    items: [
      ...Object.values(PPB_LINE_STATUS).map((v) => ({ term: v.label, text: v.hint })),
      { term: PPB_AMEND.label, text: Object.values(PPB_AMEND.hint).join(' · ') },
    ],
  },
  {
    id: 'approval', title: 'Purchase Request & PO Approval',
    items: [
      ...Object.entries(APPROVAL_STATUS).map(([k, v]) => ({ term: v.label, text: APPROVAL_HINT[k] ?? '' })),
      { term: 'Revise', text: 'The approver does not change quantities: click Revise with a note, the admin corrects it and submits again.' },
      { term: 'Delivery Order / Purchase Request in approval', text: 'Delivery Order = items can leave stock now. Purchase Request = no stock, purchased until Receipt. Final numbers are set by the system when the Director approves.' },
      { term: 'Reference', text: 'Source of the item in a Purchase Request: Item Request (request shortage) or Safety stock (restock). Click to open the source.' },
    ],
  },
  {
    id: 'ri', title: 'Receipt Source',
    items: Object.entries(RI_SOURCE).map(([k, label]) => ({ term: label, text: RI_HINT[k] ?? '' })),
  },
  {
    id: 'verifikasi', title: 'Verification & handover',
    items: [
      { term: 'Select item', text: 'One requested item may be met by more than one Product Master item (e.g. Sidu book + Sinar book). The total may not exceed the request.' },
      { term: 'Given less', text: 'When giving less than requested (e.g. 1 kept in reserve), a reason is required. The reason and admin note are read by approvers and the requester.' },
      { term: 'Stock', text: 'The stock at verification is an estimate; it is checked again after approval. Any shortage goes to Draft Purchase Request automatically.' },
      { term: 'Returned', text: 'Returned requests are verified again and sent back to approval.' },
      { term: 'Handover', text: 'The warehouse hands over the whole Delivery Order as prepared (not partly), with a proof photo and the recipient signature.' },
      { term: 'By representative (QR)', text: 'A requester who cannot collect in person clicks "By representative", fills in the name, then sends the QR / 6-digit code to the representative. The warehouse admin scans the QR (or photographs it, or types the code) at handover. The code is valid for 3 days.' },
    ],
  },
  {
    id: 'istilah', title: 'Terms',
    items: [
      { term: 'Delivery Order', text: 'Formerly NPBG: items out of stock. Document numbers still start with NPBG/.' },
      { term: 'Purchase Request', text: 'Formerly PPB: a request to buy items. Document numbers still start with PPB/.' },
      { term: 'PO', text: 'Purchase Order: purchase order to a vendor.' },
      { term: 'Purchase Request To do and Drafts', text: 'To do lists the items ready for a Purchase Request. Tick items, then Save as draft to keep them for later, or submit them at once. A draft asks nobody to approve; Request approval turns it into one Purchase Request and the usual Manager and Director approval begins. Removing a draft sends its items back to To do.' },
      { term: 'Receipt', text: 'Formerly RI: goods received at the warehouse. Document numbers still start with RI/.' },
      { term: 'Price Quotation', text: 'Formerly RFQ: each vendor\'s price for the items of a Purchase Request, before the Director picks. Not the same as the Price List (the standing price reference per item and vendor).' },
      { term: 'Physical Inventory', text: 'Formerly Stock Opname: counting the items actually in the warehouse.' },
      { term: 'UOM', text: 'Units sit in categories, each with one reference unit, and convert only inside their category (KG to GR, MTR to CM). A unit whose size differs per item, such as a pack or box, is marked Per item and gets its ratio on the Per item tab (1 PCK = 10 PCS for that item). Ratios from Accurate show there and are changed in Accurate. A per-item ratio may cross categories, for example 1 ROL = 100 MTR. A converted result lands on a multiple of the target unit\'s Rounding (0.01 keeps two decimals, 1 gives whole units). The converter itself changes nothing. Stock and stock movements are always in the Base UOM. An Item Request keeps what was asked (2 ROL) and works in the Base UOM from its verification on (200 MTR). The ratio is frozen on each transaction, so changing it here never rewrites an old one; a conversion already used cannot be deleted. A word that is no unit of the master is counted as written and listed on the Needs mapping tab; nothing is guessed. A PO can be ordered in another unit the item can convert to; its Receipt keeps the document unit and adds the converted amount to stock (3 PCK = 30 PCS), keeping the ratio used at that moment. An item with no ratio for that unit cannot be received until one is set. Serial numbers count the received document unit.' },
      { term: 'Receipt serial numbers', text: 'Optional per item, but once filled there must be exactly one per unit received, with no repeats. Open the count next to the item to type or scan them (Enter moves down, a pasted column fills downward), or use Export serial Excel, fill the yellow column, then Import serial Excel. Keep the Line ID column unchanged. A serial already recorded for the same item asks for confirmation. The printed Receipt shows the first serial and how many more; the full list is on the Receipt detail and its Excel.' },
      { term: 'Draft Purchase Request / Draft PO', text: 'Items needing a Purchase Request / PO, before submission.' },
      { term: 'Safety stock', text: 'Minimum stock limit; below it the item is suggested for purchase (restock).' },
      { term: 'Used item returned', text: 'A mark on a Delivery Order when the used item must return to the warehouse; that row goes into Used Item Return Tracking until its return Receipt is recorded.' },
      { term: 'Card without project', text: 'Stock cards not in a project yet: open the card → Card info → select a project.' },
    ],
  },
  {
    id: 'accurate', title: 'Accurate Data',
    items: [
      { term: 'Read-only', text: 'Delivery Order, Purchase Request, PO, Receipt and Physical Inventory from Accurate are not changed in STOCKWISE; POs from Accurate do not go through the internal approve / send / cancel flow.' },
      { term: 'Sync schedule', text: `Updated automatically at ${SYNC_SCHEDULE}. Its status and history are in the Accurate Integration menu.` },
      { term: 'Edit Delivery Order', text: 'Only the type (manual Delivery Order), project name, issued by and description can be changed; other fields follow Accurate.' },
      { term: 'Qty before / after', text: 'Accurate stock opname: stock in Accurate before the adjustment / physical count result.' },
      { term: 'Opening balance', text: 'Opening inventory balance (31/12/2024).' },
      { term: 'Stock adjustment', text: 'Daily inventory adjustments made in Accurate.' },
    ],
  },
  {
    id: 'tips', title: 'Form tips',
    items: [
      { term: 'Item Request', text: 'Write the item name freely; it need not match the warehouse name. Press Enter to go to the next row.' },
      { term: 'Schedule opname', text: 'Fill in filters (they can be combined), then tick items one by one or click "Add all filter results".' },
      { term: 'Price comparison', text: 'A recorded vendor can be selected again to change its price. The picked vendor price is used automatically when making the PO.' },
      { term: 'Last login / Last logout', text: 'The last sign-in, and the last time the user pressed Log out. Closing the browser or an admin ending the sessions is not a logout, so Last logout can be older than Last login while someone is still signed in.' },
      { term: 'Password', text: 'Minimum 8 characters, with letters and numbers. Give it to the user and ask them to change it through "Change Password".' },
      { term: 'Important Request', text: 'Once assigned, changes are logged and recipients are told; assigned recipients cannot be removed (more can be added). The deadline is changed from the detail page. When a request is done or cancelled its forum closes: nothing new can be posted, but comments, files and the activity history stay readable. Closed requests are listed under Done.' },
      { term: 'STPP', text: 'Description, quantity and unit are taken automatically from STPP Serial No. data.' },
    ],
  },
]

/** Panduan: every explanation in one place, so the work pages stay clean. */
export function GuidePage() {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return SECTIONS
    const has = (x: ReactNode) => typeof x === 'string' && x.toLowerCase().includes(t)
    return SECTIONS.map((s) => ({ ...s, items: s.title.toLowerCase().includes(t) ? s.items : s.items.filter((i) => has(i.term) || has(i.text)) }))
      .filter((s) => s.items.length > 0)
  }, [q])

  return (
    <div className="space-y-4">
      <PageHeader title="Guide" subtitle="Workflow, status meanings and STOCKWISE terms" />
      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="space-y-3 lg:sticky lg:top-20" aria-label="Contents">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guide…" aria-label="Search the guide" />
          </div>
          <ul className="hidden space-y-0.5 text-sm lg:block">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={cn('block rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground', !shown.some((x) => x.id === s.id) && 'opacity-40')}>{s.title}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-4">
          {shown.length === 0 && <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">Nothing matches "{q}".</p>}
          {shown.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-20 overflow-hidden rounded-lg border bg-card">
              <h2 className="border-b px-4 py-2.5 text-sm font-semibold">{s.title}</h2>
              {s.intro && <p className="px-4 pt-3 text-sm text-muted-foreground">{s.intro}</p>}
              <dl className="divide-y">
                {s.items.map((i) => (
                  <div key={i.term} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                    <dt className="font-medium">{i.term}</dt>
                    <dd className="text-muted-foreground">{i.text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
