export type ItemType = "news" | "repo" | "note";
export type RelationType = "related" | "references" | "contradicts" | "extends";

export interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  color: string;
  icon: string | null;
  description: string | null;
  created_at: string;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  url: string | null;
  summary: string | null;
  content: string | null;
  category_id: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  quality: number | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  // joined
  category?: Category;
  tags?: Tag[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ItemRelation {
  source_id: string;
  target_id: string;
  relation_type: RelationType;
  note: string | null;
  created_at: string;
}

export interface Review {
  id: string;
  category_id: string | null;
  model: string;
  items_checked: number;
  avg_quality: number | null;
  notes: string | null;
  created_at: string;
  category?: Category;
}

// Supabase generated types stub (anon key read, service key write)
export interface Database {
  public: {
    Tables: {
      categories:     { Row: Category;     Insert: Omit<Category,'id'|'created_at'>; Update: Partial<Category> };
      items:          { Row: Item;         Insert: Omit<Item,'id'|'created_at'|'updated_at'|'category'|'tags'>; Update: Partial<Item> };
      tags:           { Row: Tag;          Insert: Omit<Tag,'id'>; Update: Partial<Tag> };
      item_tags:      { Row: { item_id: string; tag_id: string }; Insert: { item_id: string; tag_id: string }; Update: never };
      item_relations: { Row: ItemRelation; Insert: Omit<ItemRelation,'created_at'>; Update: Partial<ItemRelation> };
      reviews:        { Row: Review;       Insert: Omit<Review,'id'|'created_at'>; Update: Partial<Review> };
    };
  };
}
