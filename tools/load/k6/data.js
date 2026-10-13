// Test data for the sample design's invoice app (packages/core/src/model/seed.ts). List ids are
// `<listId>_<index>` in the order the seed declares them.

export const APP = 'app_invoice'
export const WORKFLOW = 'w_invoice'
/** In the AP clerks group, which may create invoices. */
export const REQUESTER = 'u_maya'

/** Services the live invoice workflow calls: n_capture and n_post (ERP), n_remit (mail), n_archive (records). */
export const SERVICES = ['svc_erp', 'svc_mail', 'svc_records']

export const VENDORS = Array.from({ length: 10 }, (_, i) => `l_vendors_${i}`)

// Department and one of its cost centers: the clerk can't approve without a cost center.
// src/data.test.ts checks these against the seed.
export const ORG = [
  ['l_org_0', 'l_org_1'],
  ['l_org_0', 'l_org_4'],
  ['l_org_7', 'l_org_8'],
  ['l_org_7', 'l_org_11'],
  ['l_org_14', 'l_org_15'],
  ['l_org_14', 'l_org_18'],
  ['l_org_21', 'l_org_22'],
  ['l_org_21', 'l_org_25'],
]

const LINES = ['Toner cartridges', 'Freight, March', 'Network switch', 'Janitorial service', 'Software renewal', 'Office chairs']

export const pick = (a) => a[Math.floor(Math.random() * a.length)]
export const between = (lo, hi) => lo + Math.random() * (hi - lo)

// Most invoices are small, so the clerk step (≤ 1,000) gets the bulk, as in AP; the rest go to the
// managers and the Controller, whom nobody plays here.
function amount() {
  const r = Math.random()
  const v = r < 0.65 ? between(40, 1000) : r < 0.9 ? between(1000, 10000) : between(10000, 48000)
  return Math.round(v * 100) / 100
}

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

/** One invoice. `invno` must be unique; ~70% carry a PO, which the ERP worker matches. */
export function invoice(invno) {
  const total = amount()
  const [dept, cc] = pick(ORG)
  const data = {
    f_invno: invno,
    f_vendor: pick(VENDORS),
    f_amount: total,
    f_invdate: day(-Math.floor(between(0, 20))),
    f_dept: dept,
    f_cc: cc,
    f_lines: [{ id: 'row_1', c_desc: pick(LINES), c_qty: 1, c_price: total, c_total: total }],
  }
  if (Math.random() < 0.7) data.f_po = `PO-${Math.floor(between(10000, 99999))}`
  return data
}

/** A load clerk from setup.ts (`u_load_0001`…), spread over however many it made. */
export const clerk = (vu, clerks) => `u_load_${String(((vu - 1) % clerks) + 1).padStart(4, '0')}`
