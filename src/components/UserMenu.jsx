import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Thermometer, Ruler, Scale, Settings as SettingsIcon } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function getInitials(fullName, email) {
  if (fullName) {
    const parts = fullName.trim().split(' ')
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return parts[0][0].toUpperCase()
  }
  return email[0].toUpperCase()
}

export default function UserMenu() {
  const { session, signOut, isAdmin, adminMode, toggleAdminMode, unitPrefs, updateUnitPref } = useAuth()
  const [imgError, setImgError] = useState(false)
  const navigate = useNavigate()
  const user = session?.user
  const avatarUrl = user?.user_metadata?.avatar_url
  const fullName = user?.user_metadata?.full_name
  const email = user?.email
  const initials = getInitials(fullName, email)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Account menu: units, admin, settings, sign out" className={`cursor-pointer rounded-full w-11 h-11 shrink-0 overflow-hidden border border-input transition-opacity hover:opacity-80 focus:outline-none focus:ring-offset-2 ${adminMode ? 'ring-2 ring-primary ring-offset-2' : 'focus:ring-2 focus:ring-primary'}`}>
          {avatarUrl && !imgError ? (
            <img
              src={avatarUrl}
              alt={initials}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <span className="w-full h-full bg-muted flex items-center justify-center text-foreground text-sm font-bold">
              {initials}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 animate-none" style={{ opacity: 1 }}>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            {fullName && <p className="text-sm font-semibold">{fullName}</p>}
            <p className="text-xs text-muted-foreground">{email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isAdmin && (
          <DropdownMenuItem className="cursor-pointer gap-2" onClick={toggleAdminMode}>
            <ShieldCheck className={`h-4 w-4 ${adminMode ? 'text-primary-text' : 'text-muted-foreground'}`} />
            <span>Admin mode {adminMode ? 'on' : 'off'}</span>
          </DropdownMenuItem>
        )}
        {isAdmin && <DropdownMenuSeparator />}
        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onSelect={(e) => e.preventDefault()}
          onClick={() => updateUnitPref('temperature_unit', unitPrefs.temperature_unit === 'F' ? 'C' : 'F')}
        >
          <Thermometer className="h-4 w-4 text-muted-foreground" />
          <span>Temperature: °{unitPrefs.temperature_unit}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onSelect={(e) => e.preventDefault()}
          onClick={() => updateUnitPref('volume_unit', unitPrefs.volume_unit === 'us' ? 'metric' : 'us')}
        >
          <Ruler className="h-4 w-4 text-muted-foreground" />
          <span>Volume: {unitPrefs.volume_unit === 'us' ? 'US' : 'Metric'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2"
          onSelect={(e) => e.preventDefault()}
          onClick={() => updateUnitPref('mass_unit', unitPrefs.mass_unit === 'us' ? 'metric' : 'us')}
        >
          <Scale className="h-4 w-4 text-muted-foreground" />
          <span>Mass: {unitPrefs.mass_unit === 'us' ? 'US' : 'Metric'}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer gap-2" onClick={() => navigate('/settings')}>
          <SettingsIcon className="h-4 w-4 text-muted-foreground" />
          <span>Settings</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="cursor-pointer" onClick={signOut}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
