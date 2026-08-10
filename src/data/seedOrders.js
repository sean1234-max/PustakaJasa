import { CATEGORIES, standardUnitPrice } from './catalog';

export function buildInitialRowsByBlock() {
  const out = {};
  let id = 1;
  CATEGORIES.filter((c) => c.mode === 'list').forEach((cat) => {
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      out[`${cat.key}::${b}`] = cat.rows.map((label) => ({ id: id++, desc: label, qty: '' }));
    }
  });
  return out;
}

export function buildInitialPlakRows() {
  const out = {};
  let id = 1;
  CATEGORIES.forEach((cat) => {
    for (let b = 0; b < (cat.blocksCount || 1); b++) {
      out[`${cat.key}::${b}`] = [{ id: id++, jenisPlak: '' }];
    }
  });
  return out;
}

// Every seed item is priced at the standard catalog rate — unitPrice mirrors
// that so Sales's "compare against standard price" check has something to
// diff against from the very first render.
function withUnitPrice(item) {
  return { ...item, unitPrice: standardUnitPrice(item.jenisPlak) };
}

export function seedOrders() {
  const mp1Matrix = {
    'MP1::BAHASA MELAYU::PRASEKOLAH': '5', 'MP1::BAHASA MELAYU::TAHUN 1': '5',
    'MP1::BAHASA INGGERIS::PRASEKOLAH': '5', 'MP1::BAHASA INGGERIS::TAHUN 1': '5', 'MP1::BAHASA INGGERIS::TAHUN 2': '5',
    'MP1::MATEMATIK::PRASEKOLAH': '5', 'MP1::MATEMATIK::TAHUN 1': '5', 'MP1::MATEMATIK::TAHUN 2': '5',
    'MP1::SAINS::TAHUN 1': '5', 'MP1::SAINS::TAHUN 2': '5',
    'MP1::PENDIDIKAN ISLAM::PRASEKOLAH': '5', 'MP1::PENDIDIKAN ISLAM::TAHUN 1': '5', 'MP1::PENDIDIKAN ISLAM::TAHUN 2': '5',
    'MP1::BAHASA ARAB::PRASEKOLAH': '5', 'MP1::BAHASA ARAB::TAHUN 1': '5', 'MP1::BAHASA ARAB::TAHUN 2': '5',
  };
  return [
    {
      id: 'ORD-2026-041', invoiceId: 'INV-2026-041', datePlaced: '18 Jul 2026', deliveryDate: '25 Jul 2026',
      totalAmount: 450.00, status: 'Completed', priceAdjusted: false,
      sekolah: 'SK Taman Setia', sales: 'Ahmad', picName: 'Cikgu Aini', phone: '012-345 6789', remark: '',
      items: [withUnitPrice({ id: 1, jenisPlak: 'SM-13473 (SILVER)', qty: 25, harga: 120.00, categoryLabel: 'LONJAKAN SAUJANA' })],
      snapshot: {
        category: 'LONJAKAN', pbdVariant: 0,
        lineValues: {
          'LONJAKAN::0::0': 'HARI ANUGERAH LONJAKAN SAUJANA',
          'LONJAKAN::0::1': '2026',
          'LONJAKAN::0::2': 'TAHUN 1',
          'LONJAKAN::0::3': 'KEDUDUKAN PERTAMA',
        },
        matrixValues: {},
        rowsByBlock: { 'LONJAKAN::0': [{ id: 1, desc: 'TAHUN 1', qty: '10' }, { id: 2, desc: 'TAHUN 2', qty: '15' }] },
        plakRows: { 'LONJAKAN::0': [{ id: 1, jenisPlak: 'SM-13473 (SILVER)' }] },
        namaKelasRows: [{ id: 1, namaKelas: '', tahun: '' }],
      },
    },
    {
      id: 'ORD-2026-062', invoiceId: 'INV-2026-062', datePlaced: '02 Jun 2026', deliveryDate: '10 Jun 2026',
      totalAmount: 2100.00, status: 'Out for Delivery', priceAdjusted: false,
      sekolah: 'SMK Jalan Kuda', sales: 'Farah', picName: 'Cikgu Bala', phone: '013-456 7890', remark: '',
      items: [
        withUnitPrice({ id: 1, jenisPlak: 'SM-134624 (GOLD)', qty: 300, harga: 1860.00, categoryLabel: 'MP THP 1' }),
        withUnitPrice({ id: 2, jenisPlak: 'SM-13473 (SILVER)', qty: 50, harga: 240.00, categoryLabel: 'TOKOH' }),
      ],
      snapshot: null,
    },
    {
      id: 'ORD-2026-075', invoiceId: 'INV-2026-075', datePlaced: '15 May 2026', deliveryDate: '28 May 2026',
      totalAmount: 845.50, status: 'In Production', priceAdjusted: false,
      sekolah: 'SJK(C) Pei Hwa', sales: 'Ahmad', picName: 'Cikgu Mei Ling', phone: '014-567 8901', remark: '',
      items: [withUnitPrice({ id: 1, jenisPlak: 'SM-138812 (BRONZE)', qty: 216, harga: 845.50, categoryLabel: 'MP THP 2' })],
      snapshot: null,
    },
    {
      id: 'ORD-2026-089', invoiceId: null, datePlaced: '24 Apr 2026', deliveryDate: 'TBD',
      totalAmount: 542.80, status: 'Submitted to Sales', priceAdjusted: false,
      sekolah: 'SK Bukit Damai', sales: 'Farah', picName: 'Cikgu Aini', phone: '012-345 6789', remark: '',
      items: [
        withUnitPrice({
          id: 1, jenisPlak: 'SM-134624 (GOLD)', qty: 80, harga: 496.00, categoryLabel: 'MP THP 1',
          categoryKey: 'MP1', blockIdx: 0, detail: { lines: {}, matrix: mp1Matrix, rows: null },
        }),
        withUnitPrice({
          id: 2, jenisPlak: 'SM-138812 (BRONZE)', qty: 12, harga: 46.80, categoryLabel: 'TOKOH',
          categoryKey: 'TOKOH', blockIdx: 0,
          detail: {
            lines: {}, matrix: null,
            rows: [
              { id: 1, desc: 'TOKOH MURID', qty: '5' },
              { id: 2, desc: 'TOKOH NILAM', qty: '3' },
              { id: 3, desc: 'TOKOH KURIKULUM', qty: '2' },
              { id: 4, desc: 'TOKOH KOKURIKULUM', qty: '2' },
              { id: 5, desc: 'TOKOH AKADEMIK', qty: '0' },
            ],
          },
        }),
      ],
      snapshot: null,
    },
  ];
}
