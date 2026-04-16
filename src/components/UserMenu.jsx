import { useState } from 'react'
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
  const { session, signOut } = useAuth()
  const [imgError, setImgError] = useState(false)
  const user = session?.user
  const avatarUrl = user?.user_metadata?.avatar_url
  const fullName = user?.user_metadata?.full_name
  const email = user?.email
  const initials = getInitials(fullName, email)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="cursor-pointer rounded-full w-8 h-8 overflow-hidden transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2">
          {avatarUrl && !imgError ? (
            <img
              src={avatarUrl}
              alt={initials}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <span className="w-full h-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold">
              {initials}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 animate-none"  style={{ opacity: 1 }}>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            {fullName && <p className="text-sm font-semibold">{fullName}</p>}
            <p className="text-xs text-muted-foreground">{email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="cursor-pointer" onClick={signOut}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
