import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link to="/">← Back</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Privacy Policy</CardTitle>
          <p className="text-sm text-muted-foreground">Last updated: April 2026</p>
        </CardHeader>
        <CardContent className="space-y-6 text-sm text-foreground leading-relaxed">
          <section>
            <h2 className="font-semibold text-base mb-2">What we collect</h2>
            <p>
              When you sign in with Google, we receive and store your <strong>name</strong>,{' '}
              <strong>email address</strong>, and <strong>profile picture URL</strong> from
              Google. We do not receive or store your Google password.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Why we collect it</h2>
            <p>
              Your name and profile picture are used to attribute recipes you upload to the
              catalogue (e.g. "Uploaded by Jane"). Your email address is used to identify
              your account and control access to the app.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">How long we keep it</h2>
            <p>
              Your data is retained for as long as your account is active. If you request
              deletion, your account and all associated data will be removed within 30 days.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Cookies and tracking</h2>
            <p>
              We do not use tracking cookies or analytics. Your login session is stored in
              your browser's local storage to keep you signed in — this is necessary for
              the app to function and is not used for tracking.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Your rights (GDPR)</h2>
            <p>
              You have the right to access, correct, or delete the data we hold about you.
              To request deletion of your account and data, email us at{' '}
              <a href="mailto:trashmanss@gmail.com" className="underline">
                trashmanss@gmail.com
              </a>
              . We will action your request within 30 days.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Data storage</h2>
            <p>
              Your data is stored on{' '}
              <a href="https://supabase.com" className="underline" target="_blank" rel="noreferrer">
                Supabase
              </a>
              , a hosted PostgreSQL database provider. Data is stored in the EU region.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  )
}
