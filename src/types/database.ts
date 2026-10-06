// ===================================================================
// Database types
// ===================================================================
// WHAT THIS IS FOR, and why it is written by hand
//
// Supabase can generate this file for you from the live database. We
// have not done that yet, because the database does not exist yet -- the
// migrations in supabase/migrations/ are the plan, and this file is the
// same plan written in TypeScript so the screens can be built against it.
//
// WHEN THE DATABASE IS LIVE, replace this file with the generated one:
//
//   npx supabase gen types typescript --project-id YOUR_PROJECT_ID
//
// Why that matters: a hand-written type can drift away from the real
// database, and when it does TypeScript starts agreeing with things the
// database does not actually do. It stops catching mistakes and starts
// hiding them, which is worse than having no types at all.
//
// So the rule is: if you change a table in a migration, change it here
// too, and regenerate as soon as the database is live.
//
// WHY HAND-WRITE THEM AT ALL: TypeScript then catches a typo in a column
// name at compile time, instead of failing silently in the browser where
// a user sees a broken screen.
// ===================================================================

/** The four kinds of account. Defined in migration 001. */
export type UserRole = 'super_admin' | 'supplier' | 'client' | 'agent'

export type Profile = {
  id: string
  role: UserRole
  /** Only used for client and agent. Suppliers and super admins have null. */
  supplier_id: string | null
  full_name: string
  username: string
  phone: string | null
  address: string | null
  is_active: boolean
  must_change_password: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type AuditLog = {
  id: string
  actor_id: string | null
  action: string
  table_name: string
  record_id: string | null
  old_value: string | null
  new_value: string | null
  created_at: string
}

/** One person as the Super Admin's account list shows them.
 *
 *  Built from a VIEW, not a query against profiles. The Super Admin's
 *  account list has to show which Supplier each Client and Agent belongs
 *  to, and profiles stores that only as a raw uuid. A view can join it
 *  to a name. See migration 012.
 */
export type AccountListRow = {
  id: string
  full_name: string
  username: string
  role: UserRole
  supplier_id: string | null
  /** Only filled for client and agent. Null for a supplier or super admin. */
  supplier_name: string | null
  is_active: boolean
  must_change_password: boolean
  created_at: string
}

/** The six switches a Supplier can set per Client.
 *
 *  Real columns, not a JSON blob with flags inside it. That is not a
 *  style choice: a mistyped key in a JSON blob fails silently and the
 *  switch simply stays off forever, whereas a misspelled column here is
 *  a compile error the moment it is written. See migration 007.
 */
export type ClientFeatureFlags = {
  can_view_stock: boolean
  can_view_readiness: boolean
  can_view_prices: boolean
  can_place_orders: boolean
  can_view_order_history: boolean
  can_view_payments: boolean
  can_view_report_sales: boolean
  can_view_report_statement: boolean
  can_view_report_product_availability: boolean
}

// ===================================================================
// Phase 2: settings, products, views, stock
// ===================================================================

/** Currencies the database allows. Migration 005. */
export type Currency = 'IDR' | 'USD' | 'MYR' | 'SGD'

export type SupplierSettings = {
  supplier_id: string
  currency: Currency
  /** Whether a Client may order more than the Supplier has in stock. */
  allow_backorder: boolean
  page_size: number
  created_at: string
  updated_at: string
}

/** One product, as the owning Supplier sees it. Migration 006. */
export type ProductRow = {
  id: string
  supplier_id: string
  name: string
  sku: string | null
  barcode: string | null
  unit: string
  description: string | null
  photo_path: string | null
  stock_qty: number
  low_stock_level: number
  /** What the Supplier pays the Agent. Never shown to a Client. */
  agent_price: number
  /** What the Client pays. Never shown to an Agent. */
  client_price: number
  is_active: boolean
  created_at: string
  updated_at: string
}

/** How ready a product is. Computed by the database, not by the app. */
export type Readiness = 'ready' | 'low_stock' | 'not_ready'

/**
 * What a Client may see, from client_products_view.
 *
 * Note what is NOT here: agent_price, sku, supplier_id. They are absent
 * from the database view itself, not merely hidden by the screen. That is
 * the difference between a secret and a hidden field.
 *
 * The three nullable fields are nullable because the Supplier can switch
 * off permission to see them. Null means "you may not see this", which is
 * not the same as zero.
 */
export type ClientProductRow = {
  id: string
  name: string
  unit: string
  description: string | null
  photo_path: string | null
  client_price: number | null
  stock_qty: number | null
  readiness: Readiness | null
  updated_at: string
}

/**
 * What an Agent may see, from agent_products_view.
 *
 * client_price is absent on purpose. An Agent who learns what the Client
 * pays knows the Supplier's margin on every product, and can use it to
 * negotiate or to go around the Supplier.
 */
export type AgentProductRow = {
  id: string
  name: string
  unit: string
  description: string | null
  photo_path: string | null
  barcode: string | null
  stock_qty: number
  low_stock_level: number
  agent_price: number | null
  readiness: Readiness
  updated_at: string
}

/**
 * The words for a readiness badge, in both languages.
 *
 * This lives next to readinessTone in lib/products.ts on purpose. The
 * badge needs a colour AND a label, and if the two came from different
 * places they would eventually disagree: 'low_stock' could be shown in
 * amber and captioned "In stock". One table, both answers.
 */
export const READINESS_TEXT: Record<Readiness, { id: string; en: string }> = {
  ready: { id: 'Tersedia', en: 'Available' },
  low_stock: { id: 'Stok menipis', en: 'Low stock' },
  not_ready: { id: 'Belum tersedia', en: 'Not available yet' },
}

/** Any product a list screen may be showing. */
export type AnyProduct = ProductRow | ClientProductRow | AgentProductRow

/** What one page of a list needs in order to draw itself. */
export type ProductPage = {
  rows: AnyProduct[]
  total: number
  page: number
  pageSize: number
  hasNextPage: boolean
}

/**
 * What the product form sends.
 *
 * stock_qty is deliberately absent. Stock cannot be set by saving a
 * product; it moves only through adjust_stock(), which records why it
 * changed. With no field here, the compiler stops anybody from trying.
 */
export type ProductInput = {
  id?: string
  name: string
  sku?: string | null
  barcode?: string | null
  unit: string
  description?: string | null
  photo_path?: string | null
  low_stock_level: number
  agent_price: number
  client_price: number
  is_active?: boolean
}

/** Why stock changed. Migration 009. */
export type StockMovementReason =
  | 'purchase'
  | 'sale'
  | 'delivery_out'
  | 'delivery_in'
  | 'adjustment'
  | 'opening'

export type StockMovement = {
  id: string
  supplier_id: string
  product_id: string
  /** Signed change: positive adds stock, negative removes it. */
  qty_delta: number
  reason: StockMovementReason
  note: string | null
  created_by: string
  /** The stock level after this movement was applied. */
  qty_after: number
  created_at: string
}

/**
 * The per-Client switches a Supplier controls. Migration 007.
 *
 * Nine real boolean columns. All NOT NULL, so there is never a third
 * state where the answer is unknown.
 *
 * THE DEFAULTS ARE SPLIT ON PURPOSE, and the split is the important part:
 *
 *   ON by default  -- prices, stock quantity, availability, and placing
 *                     orders. These four are what make a catalogue
 *                     usable; a Supplier who switched all four off would
 *                     be handing a Client a login that shows an empty
 *                     screen. can_view_prices shows the CLIENT price,
 *                     which that Client is going to be charged anyway, so
 *                     it leaks nothing.
 *
 *   OFF by default -- order history, payments, and the three reports.
 *                     These reveal how busy a business is and what it
 *                     charges other people. Each has to be switched on
 *                     deliberately, per Client.
 *
 * So the direction of failure is deliberate: seeing too much always
 * requires an explicit click, while seeing too little is only the state
 * somebody chose.
 */
export type ClientFeatureSettings = {
  client_id: string
  supplier_id: string
  can_view_stock: boolean
  can_view_readiness: boolean
  can_view_prices: boolean
  can_place_orders: boolean
  can_view_order_history: boolean
  can_view_payments: boolean
  can_view_report_sales: boolean
  can_view_report_statement: boolean
  can_view_report_product_availability: boolean
  created_at: string
  updated_at: string
}

/** One of the nine switches. Typed as a real column name of
 *  ClientFeatureSettings, so a misspelling is a compile error rather than
 *  a flag that silently does nothing forever. */
export type FeatureFlagKey = keyof ClientFeatureFlags

/**
 * The nine switches, in display order, with the words that explain them.
 *
 * This is the single list of switches. The settings screen reads it. A
 * second copy would eventually disagree with this one, and a switch
 * nobody can explain is a switch nobody trusts.
 *
 * The Supplier needs to know what each one DOES, not just what it is
 * called. "Can view payments" means nothing to somebody who has never run
 * a business. "See what this Client has paid you" is understood at once.
 */

export const CLIENT_FEATURE_FLAGS: ReadonlyArray<{
  key: FeatureFlagKey
  labelId: string
  labelEn: string
  helpId: string
  helpEn: string
}> = [
  {
    key: 'can_view_stock',
    labelId: 'Lihat stok',
    labelEn: 'See stock',
    helpId: 'Lihat berapa stok produk tersedia',
    helpEn: 'See how many of each product is in stock',
  },
  {
    key: 'can_view_readiness',
    labelId: 'Lihat status siap',
    labelEn: 'See availability',
    helpId: 'Lihat tanda siap, stok menipis, atau belum siap',
    helpEn: 'See the ready, low stock, or not ready label',
  },
  {
    key: 'can_view_prices',
    labelId: 'Lihat harga',
    labelEn: 'See prices',
    helpId: 'Lihat harga yang akan ditagihkan ke Client ini',
    helpEn: 'See the price this Client will be charged',
  },
  {
    key: 'can_place_orders',
    labelId: 'Bisa membuat pesanan',
    labelEn: 'Can place orders',
    helpId: 'Izinkan Client ini membuat pesanan sendiri',
    helpEn: 'Let this Client create their own orders',
  },
  {
    key: 'can_view_order_history',
    labelId: 'Lihat riwayat pesanan',
    labelEn: 'See order history',
    helpId: 'Lihat pesanan yang pernah dibuat Client ini',
    helpEn: 'See the orders this Client has placed before',
  },
  {
    key: 'can_view_payments',
    labelId: 'Lihat pembayaran',
    labelEn: 'See payments',
    helpId: 'Lihat apa yang sudah dibayar Client ini',
    helpEn: 'See what this Client has paid you',
  },
  {
    key: 'can_view_report_sales',
    labelId: 'Laporan penjualan',
    labelEn: 'Sales report',
    helpId: 'Lihat laporan penjualan untuk Client ini',
    helpEn: 'Let this Client see sales reports',
  },
  {
    key: 'can_view_report_statement',
    labelId: 'Laporan tagihan',
    labelEn: 'Statement report',
    helpId: 'Lihat laporan tagihan untuk Client ini',
    helpEn: 'Let this Client see statement reports',
  },
  {
    key: 'can_view_report_product_availability',
    labelId: 'Laporan ketersediaan produk',
    labelEn: 'Product availability report',
    helpId: 'Lihat laporan ketersediaan produk',
    helpEn: 'Let this Client see product availability reports',
  },
]

// ===================================================================
// The Supabase client shape
// ===================================================================
// This is the type supabase-js uses to check .from(), .select() and
// .rpc(). Until the generated types exist, every table and view is listed
// by hand. That is enough for the compiler to catch a wrong column name
// on every query in the app.
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'created_at' | 'updated_at'> &
          Partial<Pick<Profile, 'created_at' | 'updated_at'>>
        Update: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      audit_logs: {
        Row: AuditLog
        Insert: Omit<AuditLog, 'id' | 'created_at'> &
          Partial<Pick<AuditLog, 'id' | 'created_at'>>
        // Never. The log is written by triggers and service-role code
        // only, and the compiler should keep saying so.
        Update: never
        Relationships: []
      }
      supplier_settings: {
        Row: SupplierSettings
        Insert: Omit<SupplierSettings, 'created_at' | 'updated_at'> &
          Partial<Pick<SupplierSettings, 'created_at' | 'updated_at'>>
        Update: Partial<
          Omit<SupplierSettings, 'supplier_id' | 'created_at' | 'updated_at'>
        >
        Relationships: []
      }
      products: {
        Row: ProductRow
        Insert: Omit<
          ProductRow,
          'id' | 'supplier_id' | 'stock_qty' | 'created_at' | 'updated_at'
        > &
          Partial<
            Pick<
              ProductRow,
              'id' | 'supplier_id' | 'stock_qty' | 'created_at' | 'updated_at'
            >
          >
        // stock_qty is NOT here on purpose. Migration 009 takes the right
        // to update it away, so leaving it out means the compiler will not
        // let a screen build code the database will refuse.
        Update: Partial<
          Omit<
            ProductRow,
            'id' | 'supplier_id' | 'stock_qty' | 'created_at' | 'updated_at'
          >
        >
        Relationships: []
      }
      stock_movements: {
        Row: StockMovement
        Insert: Omit<
          StockMovement,
          'id' | 'supplier_id' | 'qty_after' | 'created_at'
        > &
          Partial<
            Pick<StockMovement, 'id' | 'supplier_id' | 'qty_after' | 'created_at'>
          >
        // Never. The log is append-only, and the compiler should say so.
        Update: never
        Relationships: []
      }
      client_feature_settings: {
        Row: ClientFeatureSettings
        Insert: Omit<ClientFeatureSettings, 'client_id' | 'created_at' | 'updated_at'> &
          Partial<Pick<ClientFeatureSettings, 'created_at' | 'updated_at'>>
        Update: Partial<
          Omit<
            ClientFeatureSettings,
            'client_id' | 'supplier_id' | 'created_at' | 'updated_at'
          >
        >
        Relationships: []
      }
    }
    Views: {
      client_products_view: {
        Row: ClientProductRow
        Relationships: []
      }
      agent_products_view: {
        Row: AgentProductRow
        Relationships: []
      }
      /** Super Admin account list, with the owning Supplier's name. */
      account_list_view: {
        Row: AccountListRow
        Relationships: []
      }
    }
    Functions: {
      current_user_id: { Args: Record<string, never>; Returns: string | null }
      current_role: { Args: Record<string, never>; Returns: UserRole | null }
      current_supplier_id: { Args: Record<string, never>; Returns: string | null }
      current_is_active: { Args: Record<string, never>; Returns: boolean }
      is_super_admin: { Args: Record<string, never>; Returns: boolean }
      /** The only way stock is allowed to change. */
      adjust_stock: {
        Args: {
          p_product_id: string
          p_qty_delta: number
          p_reason: StockMovementReason
          p_note?: string | null
        }
        Returns: number
      }
      /**
       * Switch an account on or off. Never deletes.
       *
       * There is no actor argument on purpose: the wrapper takes the
       * caller from auth.uid(), so the browser cannot choose who it is
       * pretending to be. See migration 013.
       */
      set_user_active: {
        Args: { p_user_id: string; p_is_active: boolean }
        Returns: undefined
      }
      /** Ask for an account password to be reset. Migration 013. */
      request_password_reset: {
        Args: { p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      user_role: UserRole
      stock_movement_reason: StockMovementReason
    }
    CompositeTypes: Record<string, never>
  }
}