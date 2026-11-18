import { describe, expect, it } from 'vitest'
import { launcherApps } from './launcher'
import { visibleNav } from './navigation'

const appsFor = (perms: string[]) => {
  const has = (p: string) => perms.includes(p)
  return launcherApps(visibleNav(has, false), has).apps
}
const bar = (perms: string[], key: string) => appsFor(perms).find((a) => a.key === key)!.menus!.map((m) => [m.label, (m.children ?? []).map((c) => c.label)])

describe('the menu bar of an app, in the order of the work', () => {
  it('Inventory: Operations, Products, Reporting', () => {
    expect(bar(['item_request.view', 'npbg.view', 'ri.view', 'opname.view', 'item.view', 'master.category.view', 'master.unit.view'], 'inventory')).toEqual([
      ['Operations', ['Item Request', 'Delivery Order', 'Receipt', 'Physical Inventory']],
      ['Products', ['Barang', 'Jasa', 'Kategori Barang', 'UOM']],
      ['Reporting', ['Kartu Stok', 'Data Quality']],
    ])
  })

  it('Purchase: the orders from request to return, then the master data', () => {
    expect(bar(['ppb.view', 'ppb.create', 'po.view', 'po.create', 'purchase_return.view', 'rfq.view', 'master.vendor.view'], 'purchase')).toEqual([
      ['Orders', ['Draft Purchase Request', 'Purchase Request', 'Approved Purchase Request Items', 'Price Quotation', 'Purchase Order', 'Return']],
      ['Price List', ['Draft Price List', 'Master Price List']],
      ['Vendor', []],
    ])
  })

  it('drops what the role may not open; one page left is a plain link', () => {
    const m = appsFor(['mrp.view']).find((a) => a.key === 'manufacturing')!.menus!
    expect(m.map((x) => x.label)).toEqual(['Manufacturing Orders', 'Bills of Materials', 'Production History'])
    expect(m.every((x) => !x.children)).toBe(true)
  })

  it('every page of every app is in its menu bar', () => {
    for (const app of launcherApps(visibleNav(() => true, true), () => true).apps.filter((a) => a.menus)) {
      const inBar = new Set(app.menus!.flatMap((m) => (m.children ?? [m]).map((c) => c.to)))
      for (const i of app.items) for (const c of i.children?.length ? i.children : [i]) expect(inBar.has(c.to), `${app.key}: ${c.label}`).toBe(true)
    }
  })
})
