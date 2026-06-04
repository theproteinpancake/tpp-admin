begin;
insert into public.product_locations (product_id, location_id, shipbob_inventory_id)
select p.id, l.id, v.inv
from (values
  ('BMS','18166975'),
  ('BMM','18166999'),
  ('BML','18166996'),
  ('CHS','18286147'),
  ('CHM','18166998'),
  ('CHL','18166997'),
  ('SCS','18286146'),
  ('SCM','18167001'),
  ('SCL','18167000'),
  ('CCS','18286145'),
  ('CCM','18166987'),
  ('CCL','18166986'),
  ('CIS','20922202'),
  ('CIM','19227583'),
  ('CIL','19227582'),
  ('MAS','20922201'),
  ('MAM','19457815'),
  ('MAL','18286153'),
  ('GFBS','20922203'),
  ('GFBM','19227585'),
  ('GFBL','19227584'),
  ('GFCIS','20922200'),
  ('GFCIM','21796009'),
  ('GFCIL','21796008'),
  ('BM80','18286152'),
  ('CH80','18286150'),
  ('SC80','18286151'),
  ('CC80','18286149'),
  ('CI80','19227581'),
  ('MA80','18286148'),
  ('MSS','18166983'),
  ('MSS8','19227590'),
  ('ACCP','18166989'),
  ('ACCS','18166990'),
  ('ACCF','18166991'),
  ('TWM','19227586'),
  ('ACCT','18166977')
) as v(sku,inv)
join public.products p on p.sku=v.sku
join public.locations l on l.code='ALTONA'
on conflict (product_id,location_id) do update set shipbob_inventory_id=excluded.shipbob_inventory_id, active=true;

insert into public.product_locations (product_id, location_id, shipbob_inventory_id)
select p.id, l.id, v.inv
from (values
  ('BMS','21047438'),
  ('CHS','21047430'),
  ('SCS','21047429'),
  ('CCS','21047428'),
  ('CCM','21047484'),
  ('CCL','21047483'),
  ('CIS','21047401'),
  ('CIM','21047409'),
  ('CIL','21047408'),
  ('MAS','21047400'),
  ('MAM','21047437'),
  ('MAL','21047436'),
  ('GFBS','21047402'),
  ('GFBM','21047411'),
  ('GFBL','21047410'),
  ('GFCIS','21047399'),
  ('BM80','21047435'),
  ('CH80','21047433'),
  ('SC80','21047434'),
  ('CC80','21047432'),
  ('CI80','21047407'),
  ('MA80','21047431'),
  ('MSS','21047480'),
  ('MSS8','21047478'),
  ('ACCP','21047486'),
  ('ACCS','21047487'),
  ('ACCF','21047488'),
  ('TWM','21047412'),
  ('ACCT','21047440')
) as v(sku,inv)
join public.products p on p.sku=v.sku
join public.locations l on l.code='MANCHESTER'
on conflict (product_id,location_id) do update set shipbob_inventory_id=excluded.shipbob_inventory_id, active=true;
commit;