ALTER TABLE assets ADD CONSTRAINT assets_id_owner UNIQUE(id,owner_user_id);
ALTER TABLE assets ADD COLUMN source_asset_id uuid;
ALTER TABLE assets ADD CONSTRAINT assets_source_owner FOREIGN KEY(source_asset_id,owner_user_id)
 REFERENCES assets(id,owner_user_id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE assets ADD CONSTRAINT assets_source_not_self CHECK(source_asset_id IS NULL OR source_asset_id<>id);
CREATE INDEX assets_source ON assets(source_asset_id) WHERE source_asset_id IS NOT NULL;
