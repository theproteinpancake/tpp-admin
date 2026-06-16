// VISY packaging ordering — delivery destinations + signature for the order emails the agent
// drafts to Amanda at VISY. SRP cartons + ABC-line packaging go to ABC Blending (packing line,
// no WRO). Shipping cartons go to ShipBob Altona and need a WRO label on the pallet to be received.

// Where SRP cartons + anything ABC packs with goes — straight to the blending line, no WRO.
export const ABC_DELIVERY = {
  company: 'ABC Blending',
  attn: 'Stephen White',
  email: 'stephen@abcblending.com.au',
  phone: '0423 575 121',
  address: '15/257 Colchester Road, Kilsyth VIC 3137',
};

// Where ShipBob shipping cartons go — must arrive with a WRO label affixed to the pallet.
export const ALTONA_DELIVERY = {
  company: 'The Protein Pancake C/O ShipBob',
  attn: 'Inbound Receiving',
  address: '21-27 Marshall Court, Altona VIC 3018',
};

export const VISY_SIGNATURE =
`Flipping Regards,
Luke Rolls
Founder | The Protein Pancake
P: +61 0412 474 330
E: luke@theproteinpancake.co
W: theproteinpancake.co`;

// "For delivery to;" block, formatted to match Luke's manual VISY emails.
export function deliveryBlock(dest: 'ABC' | 'ALTONA'): string {
  if (dest === 'ALTONA') {
    return [
      'For delivery to;',
      `Company: ${ALTONA_DELIVERY.company}`,
      `ATT: ${ALTONA_DELIVERY.attn}`,
      ALTONA_DELIVERY.address,
      '',
      'Please dispatch with the attached WRO label affixed to the pallet so ShipBob can receive it.',
    ].join('\n');
  }
  return [
    'For delivery to;',
    `Company: ${ABC_DELIVERY.company}`,
    `ATT: ${ABC_DELIVERY.attn}`,
    `Email: ${ABC_DELIVERY.email}`,
    `Phone: ${ABC_DELIVERY.phone}`,
    ABC_DELIVERY.address,
  ].join('\n');
}
