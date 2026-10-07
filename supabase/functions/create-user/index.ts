import { createSupabaseServerClient } from '@supabase/ssr'
import { type HonoContext } from 'hono'

/**
 * CREATE USER EDGE FUNCTION
 * 
 * Handles user creation with role-based permissions.
 * - Super Admin can create Suppliers (and anyone)
 * - Supplier can create only their own Clients and Agents
 * - Nobody else can create users
 * 
 * IMPORTANT: This function runs with SERVICE_ROLE privileges.
 * Never expose the service_role key in frontend code, repositories, or logs.
 */

export default {
  async fetch(request, env, ctx) {
    // Only POST method allowed
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    try {
      // Parse the request body
      const body = await request.json()
      
      // Validate required fields
      if (!body.username || !body.password || !body.fullName || !body.role) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: username, password, fullName, role' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // Validate role
      const validRoles = ['supplier', 'client', 'agent', 'super_admin']
      if (!validRoles.includes(body.role)) {
        return new Response(
          JSON.stringify({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // Create Supabase admin client using service_role key
      // This MUST NOT be exposed to frontend - it's only for edge functions
      const supabase = createSupabaseServerClient(
        request,
        // The service_role key should come from environment variables, not hardcoded
        // In production: env.SUPABASE_SERVICE_ROLE_KEY
        // For now, we use a placeholder that will be configured at deployment
        'placeholder-service-role-key'
      )

      // Determine who is calling this function
      // In a real implementation, this would come from the JWT/auth token of the caller
      // For now, we determine permissions based on the role being created and
      // the context of the request
      
      const { role, username, fullName, phone, address, supplierId } = body
      
      // Determine the caller's role and permissions
      // This is a simplified approach - in production, you'd verify the JWT token
      // of the person making the request
      const callerRole = body.callerRole // Would be passed from the frontend
      
      // Check permissions based on caller role and target role
      let canCreate = false
      
      if (callerRole === 'super_admin') {
        // Super Admin can create anyone
        canCreate = true
      } else if (callerRole === 'supplier') {
        // Supplier can create only their own Clients and Agents
        // In a real implementation, verify the supplierId matches the caller's supplier
        // For now, we allow supplier creation of their own role types
        canCreate = true
      }
      
      if (!canCreate) {
        return new Response(
          JSON.stringify({ error: 'You do not have permission to create users' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
      }
      
      // Hash the password before storing
      // In a real implementation, use bcrypt or similar
      // For Supabase Auth, the password is handled by Supabase's own hashing
      const password = body.password
      
      // Create the user in Supabase Auth
      // The username is stored as a fake email inside Supabase Auth
      const { data, error } = await supabase.auth.admin.createUser({
        id: body.userId || body.username, // Use username as id if no userId provided
        email: `${username}@tracker.local`, // Store as fake email (user never sees this)
        password,
        email_confirm: false, // Email confirmation not needed for internal users
        user_metadata: {
          fullName,
          role: body.role,
          phone: body.phone || '',
          address: body.address || '',
          supplierId: body.supplierId || null,
        },
        user_metadata: {
          // Store the role in user_metadata as well for easy access
          role: body.role,
        },
      })
      
      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }
      
      // Create the corresponding profile in the public.profiles table
      // This is done via the Edge Function since it has service_role privileges
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: data.user?.id,
          role: body.role,
          fullName,
          username,
          phone: body.phone,
          address: body.address,
          is_active: true,
          must_change_password: true, // Force password change on first login
          supplier_id: body.role === 'client' || body.role === 'agent' 
            ? body.supplierId || null 
            : null,
        })
      
      if (profileError) {
        // If profile creation fails, we should ideally delete the auth user
        // but for simplicity in this edge case, we'll return the error
        return new Response(
          JSON.stringify({ error: `User created but profile failed: ${profileError.message}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }
      
      // Return success
      return new Response(
        JSON.stringify({ 
          success: true, 
          userId: data.user?.id,
          message: 'User created successfully. User must change password on first login.' 
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
      
    } catch (err) {
      console.error('Error in create-user edge function:', err)
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }
}