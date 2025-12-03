// Authorizer event handlers for Floor Markets DeFi Platform
// Handles role creation, permissions, and role member assignment
// Note: AuthorizerContract entity creation is handled in factory-handlers.ts

import type { Role_t, RoleMember_t, RolePermission_t } from '../generated/src/db/Entities.gen'
import { Authorizer } from '../generated/src/Handlers.gen'
import { handlerErrorWrapper, normalizeAddress } from './helpers'

/**
 * Constants for static roles
 */
const BURN_ADMIN_ROLE = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

/**
 * Helper function to normalize hex string (already in bytes32 format from events)
 */
function normalizeHexString(value: string): string {
  return value.toLowerCase()
}

/**
 * Helper to create a unique ID for Role entity
 * Format: {authorizer_address}-{roleId_hex}
 */
function createRoleId(authorizerAddress: string, roleId: string): string {
  return `${normalizeAddress(authorizerAddress)}-${roleId.toLowerCase()}`
}

/**
 * Helper to create a unique ID for RolePermission entity
 * Format: {role_id}-{target}-{selector}
 */
function createPermissionId(roleId: string, target: string, selector: string): string {
  return `${roleId}-${normalizeAddress(target)}-${selector.toLowerCase()}`
}

/**
 * Helper to create a unique ID for RoleMember entity
 * Format: {role_id}-{member_address}
 */
function createMemberId(roleId: string, member: string): string {
  return `${roleId}-${normalizeAddress(member)}`
}

/**
 * @notice Handles RoleCreated event
 * Creates a new Role entity when a role is dynamically created in the authorizer
 */
Authorizer.RoleCreated.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const authorizerAddress = event.srcAddress
    const roleId = normalizeHexString(event.params.roleId_)
    const roleName = event.params.roleName
    const timestamp = BigInt(event.block.timestamp)

    context.log.info(
      `[RoleCreated] New role created | authorizer=${authorizerAddress} | roleId=${roleId} | name=${roleName}`
    )

    const normalizedAuthorizer = normalizeAddress(authorizerAddress)

    // Get authorizer to update lastAssignedRoleId
    const authorizer = await context.AuthorizerContract.get(normalizedAuthorizer)
    if (!authorizer) {
      context.log.warn(
        `[RoleCreated] AuthorizerContract not found | authorizer=${normalizedAuthorizer}`
      )
      return
    }

    // Parse the roleId to extract numeric value
    const roleIdNum = BigInt(roleId)
    if (roleIdNum > authorizer.lastAssignedRoleId) {
      context.AuthorizerContract.set({
        ...authorizer,
        lastAssignedRoleId: roleIdNum,
        lastUpdatedAt: timestamp,
      })
    }

    // Create new Role entity
    const role: Role_t = {
      id: createRoleId(normalizedAuthorizer, roleId),
      authorizer_id: normalizedAuthorizer,
      roleId: roleId,
      name: roleName || undefined,
      adminRole: undefined,
      isAdminBurned: false,
      createdAt: timestamp,
      lastUpdatedAt: timestamp,
    }

    context.Role.set(role)

    context.log.debug(
      `[RoleCreated] ✅ Role created | roleId=${createRoleId(normalizedAuthorizer, roleId)}`
    )
  })
)

/**
 * @notice Handles RoleLabeled event
 * Updates the name/label of an existing role
 */
Authorizer.RoleLabeled.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const authorizerAddress = event.srcAddress
    const roleId = normalizeHexString(event.params.roleId_)
    const newRoleName = event.params.newRoleName
    const timestamp = BigInt(event.block.timestamp)

    context.log.info(
      `[RoleLabeled] Role labeled | authorizer=${authorizerAddress} | roleId=${roleId} | newName=${newRoleName}`
    )

    const normalizedAuthorizer = normalizeAddress(authorizerAddress)
    const roleEntityId = createRoleId(normalizedAuthorizer, roleId)

    // Get and update the role
    const role = await context.Role.get(roleEntityId)
    if (!role) {
      context.log.warn(`[RoleLabeled] Role not found | roleId=${roleEntityId}`)
      return
    }

    context.Role.set({
      ...role,
      name: newRoleName || undefined,
      lastUpdatedAt: timestamp,
    })

    context.log.debug(
      `[RoleLabeled] ✅ Role labeled | roleId=${roleEntityId} | name=${newRoleName}`
    )
  })
)

/**
 * @notice Handles RoleAdminChanged event
 * Updates the adminRole field when a role's admin is set or transferred
 * This event is emitted when:
 * - A role is created (to set initial admin via _setRoleAdmin)
 * - Admin is transferred via transferAdminRole()
 */
Authorizer.RoleAdminChanged.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const authorizerAddress = event.srcAddress
    const roleId = normalizeHexString(event.params.role)
    const previousAdminRole = normalizeHexString(event.params.previousAdminRole)
    const newAdminRole = normalizeHexString(event.params.newAdminRole)
    const timestamp = BigInt(event.block.timestamp)

    context.log.info(
      `[RoleAdminChanged] Admin changed | authorizer=${authorizerAddress} | roleId=${roleId} | previousAdmin=${previousAdminRole} | newAdmin=${newAdminRole}`
    )

    const normalizedAuthorizer = normalizeAddress(authorizerAddress)
    const roleEntityId = createRoleId(normalizedAuthorizer, roleId)

    // Get and update the role
    const role = await context.Role.get(roleEntityId)
    if (!role) {
      context.log.warn(`[RoleAdminChanged] Role not found | roleId=${roleEntityId}`)
      return
    }

    context.Role.set({
      ...role,
      adminRole: newAdminRole,
      lastUpdatedAt: timestamp,
    })

    context.log.debug(
      `[RoleAdminChanged] ✅ Role admin updated | roleId=${roleEntityId} | adminRole=${newAdminRole}`
    )
  })
)

/**
 * @notice Handles AccessPermissionAdded event
 * Creates a RolePermission entity when a function is assigned to a role
 */
Authorizer.AccessPermissionAdded.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const authorizerAddress = event.srcAddress
    const target = event.params.target_
    const selector = event.params.functionSelector_
    const roleId = normalizeHexString(event.params.roleId_)
    const timestamp = BigInt(event.block.timestamp)

    context.log.info(
      `[AccessPermissionAdded] Permission added | authorizer=${authorizerAddress} | roleId=${roleId} | target=${target} | selector=${selector}`
    )

    const normalizedAuthorizer = normalizeAddress(authorizerAddress)
    const roleEntityId = createRoleId(normalizedAuthorizer, roleId)
    const normalizedTarget = normalizeAddress(target)
    const permissionId = createPermissionId(roleEntityId, normalizedTarget, selector)

    // Create RolePermission entity
    const permission: RolePermission_t = {
      id: permissionId,
      role_id: roleEntityId,
      target: normalizedTarget,
      selector: selector,
      addedAt: timestamp,
      transactionHash: event.transaction.hash,
    }

    context.RolePermission.set(permission)

    context.log.debug(
      `[AccessPermissionAdded] ✅ Permission created | permissionId=${permissionId}`
    )
  })
)

/**
 * @notice Handles AccessPermissionRemoved event
 * Deletes a RolePermission entity when a function is removed from a role
 */
Authorizer.AccessPermissionRemoved.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const authorizerAddress = event.srcAddress
    const target = event.params.target_
    const selector = event.params.functionSelector_
    const roleId = normalizeHexString(event.params.roleId_)

    context.log.info(
      `[AccessPermissionRemoved] Permission removed | authorizer=${authorizerAddress} | roleId=${roleId} | target=${target} | selector=${selector}`
    )

    const normalizedAuthorizer = normalizeAddress(authorizerAddress)
    const roleEntityId = createRoleId(normalizedAuthorizer, roleId)
    const normalizedTarget = normalizeAddress(target)
    const permissionId = createPermissionId(roleEntityId, normalizedTarget, selector)

    // Delete RolePermission entity
    context.RolePermission.deleteUnsafe(permissionId)

    context.log.debug(
      `[AccessPermissionRemoved] ✅ Permission deleted | permissionId=${permissionId}`
    )
  })
)

/**
 * @notice Handles RoleGranted event
 * Creates a RoleMember entity when an address is granted a role
 */
Authorizer.RoleGranted.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const authorizerAddress = event.srcAddress
    const roleId = normalizeHexString(event.params.role)
    const account = event.params.account
    const sender = event.params.sender
    const timestamp = BigInt(event.block.timestamp)

    context.log.info(
      `[RoleGranted] Role granted | authorizer=${authorizerAddress} | roleId=${roleId} | account=${account} | sender=${sender}`
    )

    const normalizedAuthorizer = normalizeAddress(authorizerAddress)
    const normalizedAccount = normalizeAddress(account)
    const normalizedSender = normalizeAddress(sender)
    const roleEntityId = createRoleId(normalizedAuthorizer, roleId)
    const memberId = createMemberId(roleEntityId, normalizedAccount)

    // Create RoleMember entity
    const member: RoleMember_t = {
      id: memberId,
      role_id: roleEntityId,
      member: normalizedAccount,
      grantedBy: normalizedSender,
      grantedAt: timestamp,
      transactionHash: event.transaction.hash,
    }

    context.RoleMember.set(member)

    context.log.debug(
      `[RoleGranted] ✅ RoleMember created | memberId=${memberId} | member=${normalizedAccount}`
    )
  })
)

/**
 * @notice Handles RoleRevoked event
 * Deletes a RoleMember entity when an address is revoked from a role
 */
Authorizer.RoleRevoked.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const authorizerAddress = event.srcAddress
    const roleId = normalizeHexString(event.params.role)
    const account = event.params.account
    const sender = event.params.sender

    context.log.info(
      `[RoleRevoked] Role revoked | authorizer=${authorizerAddress} | roleId=${roleId} | account=${account} | sender=${sender}`
    )

    const normalizedAuthorizer = normalizeAddress(authorizerAddress)
    const normalizedAccount = normalizeAddress(account)
    const roleEntityId = createRoleId(normalizedAuthorizer, roleId)
    const memberId = createMemberId(roleEntityId, normalizedAccount)

    // Delete RoleMember entity
    context.RoleMember.deleteUnsafe(memberId)

    context.log.debug(
      `[RoleRevoked] ✅ RoleMember deleted | memberId=${memberId} | member=${normalizedAccount}`
    )
  })
)

/**
 * @notice Handles RoleAdminBurned event
 * Updates Role.isAdminBurned flag when an admin role is burned (made immutable)
 */
Authorizer.RoleAdminBurned.handler(
  handlerErrorWrapper(async ({ event, context }) => {
    const authorizerAddress = event.srcAddress
    const roleId = normalizeHexString(event.params.roleId_)
    const timestamp = BigInt(event.block.timestamp)

    context.log.info(
      `[RoleAdminBurned] Role admin burned | authorizer=${authorizerAddress} | roleId=${roleId}`
    )

    const normalizedAuthorizer = normalizeAddress(authorizerAddress)
    const roleEntityId = createRoleId(normalizedAuthorizer, roleId)

    // Get and update the role
    const role = await context.Role.get(roleEntityId)
    if (!role) {
      context.log.warn(`[RoleAdminBurned] Role not found | roleId=${roleEntityId}`)
      return
    }

    context.Role.set({
      ...role,
      isAdminBurned: true,
      adminRole: BURN_ADMIN_ROLE,
      lastUpdatedAt: timestamp,
    })

    context.log.debug(
      `[RoleAdminBurned] ✅ Role admin burned | roleId=${roleEntityId} | adminRole=${BURN_ADMIN_ROLE}`
    )
  })
)
