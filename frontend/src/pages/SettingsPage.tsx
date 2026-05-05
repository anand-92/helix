import { useEffect, useState } from 'react'
import { Settings, Save, AlertCircle, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useSettingsStore } from '@/store/useSettingsStore'
import { isValidUrl, DEFAULT_SETTINGS, type AppSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

// Form state uses strings for number inputs to allow intermediate states like ""
interface FormValues {
  apiEndpointUrl: string
  wsReconnectIntervalSecs: string
  maxReconnectAttempts: string
  theme: string
}

interface FormErrors {
  apiEndpointUrl?: string
  wsReconnectIntervalSecs?: string
  maxReconnectAttempts?: string
}

function settingsToForm(settings: AppSettings): FormValues {
  return {
    apiEndpointUrl: settings.apiEndpointUrl,
    wsReconnectIntervalSecs: String(settings.wsReconnectIntervalSecs),
    maxReconnectAttempts: String(settings.maxReconnectAttempts),
    theme: settings.theme,
  }
}

function validateForm(values: FormValues): FormErrors {
  const errors: FormErrors = {}

  if (!isValidUrl(values.apiEndpointUrl)) {
    errors.apiEndpointUrl = 'Invalid URL. Use a valid http:// or https:// address.'
  }

  const interval = Number(values.wsReconnectIntervalSecs)
  if (!Number.isFinite(interval) || interval < 1 || values.wsReconnectIntervalSecs.trim() === '') {
    errors.wsReconnectIntervalSecs = 'Reconnect interval must be at least 1 second.'
  }

  const maxAttempts = Number(values.maxReconnectAttempts)
  if (
    !Number.isFinite(maxAttempts) ||
    maxAttempts < 1 ||
    !Number.isInteger(maxAttempts) ||
    values.maxReconnectAttempts.trim() === ''
  ) {
    errors.maxReconnectAttempts = 'Max reconnect attempts must be a whole number ≥ 1.'
  }

  return errors
}

function SettingsSkeleton() {
  return (
    <div className="p-6 flex flex-col gap-6 max-w-2xl" data-testid="settings-skeleton">
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>

      {Array.from({ length: 2 }).map((_, cardIndex) => (
        <div key={cardIndex} className="rounded-lg border border-border/40 bg-card/50 p-6">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="mt-2 h-4 w-72" />
          <div className="mt-6 flex flex-col gap-5">
            {Array.from({ length: cardIndex === 0 ? 3 : 1 }).map((__, fieldIndex) => (
              <div key={fieldIndex} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-full rounded-lg" />
                <Skeleton className="h-3 w-56" />
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-32 rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { settings, updateSettings } = useSettingsStore()

  const [formValues, setFormValues] = useState<FormValues>(() => settingsToForm(settings))
  const [errors, setErrors] = useState<FormErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // Update document title
  useEffect(() => {
    document.title = 'Settings | Helix'
    const timeoutId = window.setTimeout(() => setHydrated(true), 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  if (!hydrated) {
    return <SettingsSkeleton />
  }

  function handleChange<K extends keyof FormValues>(field: K, value: FormValues[K]) {
    setFormValues((prev) => ({ ...prev, [field]: value }))
    setIsDirty(true)
    // Clear field-level error on change
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field as keyof FormErrors]
        return next
      })
    }
    setSaveError(null)
  }

  function handleSave() {
    setSaveError(null)
    const validationErrors = validateForm(formValues)
    setErrors(validationErrors)

    if (Object.keys(validationErrors).length > 0) {
      return
    }

    try {
      const newSettings: AppSettings = {
        apiEndpointUrl: formValues.apiEndpointUrl.trim(),
        wsReconnectIntervalSecs: Number(formValues.wsReconnectIntervalSecs),
        maxReconnectAttempts: Number(formValues.maxReconnectAttempts),
        theme: formValues.theme as AppSettings['theme'],
      }
      updateSettings(newSettings)
      setIsDirty(false)
      toast.success('Settings saved', {
        description: 'Your settings have been applied and persisted.',
        duration: 3000,
      })
    } catch {
      // Retain edits on error — do NOT reset formValues
      setSaveError('Failed to save settings. Check that your browser allows localStorage writes.')
    }
  }

  function handleReset() {
    setFormValues(settingsToForm(DEFAULT_SETTINGS))
    setErrors({})
    setSaveError(null)
    setIsDirty(true)
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-2xl">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure the Helix application. Changes take effect immediately after saving.
        </p>
      </div>

      {/* Connection Settings */}
      <Card className="interactive-card border-border/50">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Connection</CardTitle>
          </div>
          <CardDescription>
            Configure backend API and WebSocket connection parameters.
          </CardDescription>
        </CardHeader>
        <Separator className="mb-0" />
        <CardContent className="pt-6 flex flex-col gap-5">
          {/* API Endpoint URL */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="apiEndpointUrl"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              API Endpoint URL
            </label>
            <Input
              id="apiEndpointUrl"
              type="text"
              placeholder={DEFAULT_SETTINGS.apiEndpointUrl}
              value={formValues.apiEndpointUrl}
              onChange={(e) => handleChange('apiEndpointUrl', e.target.value)}
              aria-invalid={!!errors.apiEndpointUrl}
              aria-describedby={errors.apiEndpointUrl ? 'apiEndpointUrl-error' : undefined}
              data-testid="input-api-url"
            />
            {errors.apiEndpointUrl && (
              <p
                id="apiEndpointUrl-error"
                role="alert"
                className="flex items-center gap-1.5 text-xs text-destructive"
                data-testid="error-api-url"
              >
                <AlertCircle className="h-3 w-3 shrink-0" />
                {errors.apiEndpointUrl}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              The base URL of the FastAPI backend. Default:{' '}
              <code className="font-mono text-foreground/70">
                {DEFAULT_SETTINGS.apiEndpointUrl}
              </code>
            </p>
          </div>

          {/* WebSocket reconnect interval */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="wsReconnectIntervalSecs"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              WebSocket Reconnect Interval (seconds)
            </label>
            <Input
              id="wsReconnectIntervalSecs"
              type="number"
              min={1}
              step={1}
              placeholder={String(DEFAULT_SETTINGS.wsReconnectIntervalSecs)}
              value={formValues.wsReconnectIntervalSecs}
              onChange={(e) => handleChange('wsReconnectIntervalSecs', e.target.value)}
              aria-invalid={!!errors.wsReconnectIntervalSecs}
              aria-describedby={
                errors.wsReconnectIntervalSecs ? 'wsReconnectIntervalSecs-error' : undefined
              }
              data-testid="input-reconnect-interval"
              className="w-36"
            />
            {errors.wsReconnectIntervalSecs && (
              <p
                id="wsReconnectIntervalSecs-error"
                role="alert"
                className="flex items-center gap-1.5 text-xs text-destructive"
                data-testid="error-reconnect-interval"
              >
                <AlertCircle className="h-3 w-3 shrink-0" />
                {errors.wsReconnectIntervalSecs}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Base delay before first reconnect attempt. Uses exponential backoff. Default:{' '}
              <code className="font-mono text-foreground/70">
                {DEFAULT_SETTINGS.wsReconnectIntervalSecs}s
              </code>
            </p>
          </div>

          {/* Max reconnect attempts */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="maxReconnectAttempts"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Max Reconnect Attempts
            </label>
            <Input
              id="maxReconnectAttempts"
              type="number"
              min={1}
              step={1}
              placeholder={String(DEFAULT_SETTINGS.maxReconnectAttempts)}
              value={formValues.maxReconnectAttempts}
              onChange={(e) => handleChange('maxReconnectAttempts', e.target.value)}
              aria-invalid={!!errors.maxReconnectAttempts}
              aria-describedby={
                errors.maxReconnectAttempts ? 'maxReconnectAttempts-error' : undefined
              }
              data-testid="input-max-attempts"
              className="w-36"
            />
            {errors.maxReconnectAttempts && (
              <p
                id="maxReconnectAttempts-error"
                role="alert"
                className="flex items-center gap-1.5 text-xs text-destructive"
                data-testid="error-max-attempts"
              >
                <AlertCircle className="h-3 w-3 shrink-0" />
                {errors.maxReconnectAttempts}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Maximum number of reconnect attempts before giving up. Default:{' '}
              <code className="font-mono text-foreground/70">
                {DEFAULT_SETTINGS.maxReconnectAttempts}
              </code>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Appearance Settings */}
      <Card className="interactive-card border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Control the visual theme and motion preferences.</CardDescription>
        </CardHeader>
        <Separator className="mb-0" />
        <CardContent className="pt-6 flex flex-col gap-5">
          {/* Theme preference */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="theme" className="text-sm font-medium leading-none">
              Theme
            </label>
            <select
              id="theme"
              value={formValues.theme}
              onChange={(e) => handleChange('theme', e.target.value)}
              data-testid="select-theme"
              className={cn(
                'interactive-button h-8 w-48 rounded-lg border border-input bg-transparent px-2.5 py-1',
                'text-sm text-foreground transition-colors outline-none',
                'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                'dark:bg-input/30 cursor-pointer',
              )}
            >
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
            <p className="text-xs text-muted-foreground">
              <strong>Dark:</strong> always OLED-black dark mode with full animations.{' '}
              <strong>System:</strong> follows OS preference and respects{' '}
              <code className="font-mono">prefers-reduced-motion</code>. Light mode support is
              planned for a future release.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Save Controls */}
      <div className="flex flex-col gap-3">
        {/* Save error message */}
        {saveError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            data-testid="save-error"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={!isDirty && Object.keys(errors).length === 0}
            className="interactive-button"
            data-testid="btn-save"
          >
            <Save data-icon="inline-start" />
            Save Settings
          </Button>
          <Button
            variant="outline"
            onClick={handleReset}
            className="interactive-button"
            data-testid="btn-reset"
          >
            <RotateCcw data-icon="inline-start" />
            Reset to Defaults
          </Button>
        </div>

        {!isDirty && Object.keys(errors).length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="saved-indicator">
            All settings are saved.
          </p>
        )}
      </div>
    </div>
  )
}
