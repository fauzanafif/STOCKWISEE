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
      { term: 'Manual Delivery Order', text: 'A Delivery Order not from an Item Request is approved by Manager then Director before items leave stock.' },
      { term: 'Purchase return', text: 'Created from a Receipt → ship the items to the vendor (shipping proof photo) → mark done when the vendor settles it (replacement / bill deduction).' },
      { term: 'Stock opname', text: '1. Schedule: the admin selects the warehouse & items to count. 2. Count: the counter fills in the physical quantity (system stock is hidden); items with a difference must have a note. 3. Review: the warehouse admin approves, rejects, or asks for a recount. 4. Done: approved differences adjust the stock automatically.' },
    ],
  },
  {
    id: 'cara', title: 'How to use the pages', items: [
      { term: 'Tracking tables', text: 'Type directly in the table; it saves automatically. A blue row is a new row: fill it and press Enter.' },
      { term: 'STPP', text: 'Fill in Return Mark to mark the tool as returned automatically (PASSIVE).' },
      { term: 'Stock Card', text: 'Fill in the date, remarks, and In / Out; or type the Balance, and In / Out is calculated. Press Enter to save.' },
      { term: 'Delivery Order / Purchase Request columns in Physical Inventory', text: 'Delivery Order / Purchase Request rows per item in the selected period. Click the number to see the list.' },
      { term: 'Physical Inventory Differences', text: 'Items whose quantity differs from stock must have a note. If any is missed, the system names the item code.' },
      { term: 'Request Verification', text: 'Select an item in the Requested items table, then match it with the Product Master.' },
      { term: 'Approval', text: 'Approve, reject, or click Revise if something is not right; the document creator corrects it. The approver does not change quantities.' },
      { term: 'Approved Purchase Request Items', text: 'Items from approved Purchase Requests. Tick the items that need prices, then move them to RFQ.' },
      { term: 'RFQ', text: 'Purchasing records the price, availability, and ETA of each vendor, then submits to the Director. The Director picks one vendor per item and the pick is tagged, then the item moves to the History tab. In History the Director can change the pick to another vendor that quoted, or return the item to purchasing, while it is not a PO yet. A reason of at least 5 characters is required and every change is recorded. Once the item is in a PO it can only be read.' },
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
      { term: 'RFQ', text: 'Formerly Price Quotation: request for quotation, each vendor\'s price before the Director picks.' },
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
