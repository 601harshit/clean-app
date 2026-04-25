/**
 * ConditionPicker component tests.
 *
 * Verifies:
 *   - All four conditions render as checkboxes
 *   - Initial conditions are pre-checked
 *   - Toggling a checkbox calls updateProfile with the new array
 *   - Status banner shows Saving → Saved on success, Error on failure
 *   - Auth-token absence surfaces an error rather than silently no-oping
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ConditionPicker } from '@/components/ConditionPicker'

const mockUpdateProfile = jest.fn()
jest.mock('@/lib/api', () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}))

const mockGetSession = jest.fn()
jest.mock('@/lib/supabase', () => ({
  createClient: () => ({
    auth: { getSession: () => mockGetSession() },
  }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'tok-abc' } },
  })
  mockUpdateProfile.mockResolvedValue({
    health_conditions: [],
  })
})

describe('ConditionPicker', () => {
  it('renders all four condition checkboxes', () => {
    render(<ConditionPicker initialConditions={[]} />)
    expect(screen.getByRole('checkbox', { name: /^diabetes/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^high cholesterol/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^hypertension/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^obesity/i })).toBeInTheDocument()
  })

  it('pre-checks the initial conditions', () => {
    render(
      <ConditionPicker initialConditions={['diabetes', 'obesity']} />,
    )
    expect(screen.getByRole('checkbox', { name: /^diabetes/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^obesity/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^hypertension/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^high cholesterol/i })).not.toBeChecked()
  })

  it('toggling a checkbox calls updateProfile with the new array', async () => {
    const user = userEvent.setup()
    render(<ConditionPicker initialConditions={[]} />)

    await user.click(screen.getByRole('checkbox', { name: /^diabetes/i }))

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalled())
    expect(mockUpdateProfile).toHaveBeenLastCalledWith(['diabetes'], {
      token: 'tok-abc',
    })
  })

  it('unchecking a condition removes it from the saved array', async () => {
    const user = userEvent.setup()
    render(
      <ConditionPicker initialConditions={['diabetes', 'obesity']} />,
    )

    await user.click(screen.getByRole('checkbox', { name: /^diabetes/i }))

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalled())
    const lastCall = mockUpdateProfile.mock.calls.at(-1)
    const conditionsArg = lastCall?.[0] as string[]
    expect(conditionsArg).toEqual(['obesity'])
  })

  it('shows "Saved" after a successful update', async () => {
    const user = userEvent.setup()
    render(<ConditionPicker initialConditions={[]} />)

    await user.click(screen.getByRole('checkbox', { name: /^hypertension/i }))

    await waitFor(() => {
      expect(
        screen.getByTestId('condition-picker-status'),
      ).toHaveTextContent(/saved/i)
    })
  })

  it('shows an error message when updateProfile rejects', async () => {
    mockUpdateProfile.mockRejectedValueOnce(new Error('500'))
    const user = userEvent.setup()
    render(<ConditionPicker initialConditions={[]} />)

    await user.click(screen.getByRole('checkbox', { name: /^obesity/i }))

    await waitFor(() => {
      expect(
        screen.getByTestId('condition-picker-status'),
      ).toHaveTextContent(/could not save/i)
    })
  })

  it('shows an error when the supabase session has no access token', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    const user = userEvent.setup()
    render(<ConditionPicker initialConditions={[]} />)

    await user.click(screen.getByRole('checkbox', { name: /^diabetes/i }))

    await waitFor(() => {
      expect(
        screen.getByTestId('condition-picker-status'),
      ).toHaveTextContent(/could not save/i)
    })
    expect(mockUpdateProfile).not.toHaveBeenCalled()
  })

  it('toggling a second condition includes the first in the payload', async () => {
    const user = userEvent.setup()
    render(<ConditionPicker initialConditions={['diabetes']} />)

    await user.click(screen.getByRole('checkbox', { name: /^hypertension/i }))

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalled())
    const conditions = mockUpdateProfile.mock.calls.at(-1)?.[0] as string[]
    expect(new Set(conditions)).toEqual(new Set(['diabetes', 'hypertension']))
  })
})
