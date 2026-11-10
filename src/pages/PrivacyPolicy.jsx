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
          <p className="text-sm text-muted-foreground">Last updated: November 2026</p>
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
            <h2 className="font-semibold text-base mb-2">Recipes you upload</h2>
            <p>
              Recipe PDFs you upload are stored on Supabase and shared with the other members of the app. To read a
              recipe (its name, ingredients, steps and nutrition), the PDF is sent to Google's Gemini API. Where a card
              doesn't print nutrition values, Gemini estimates them from the ingredients; estimates are marked as such.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Households</h2>
            <p>
              Each account belongs to a household (to begin with, a household of just you). Your shopping list, the
              recipes you pick and the quantities you adjust belong to your household, so everyone in it sees the same
              list.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Albert Heijn link (optional)</h2>
            <p>
              If Albert Heijn linking is switched on for your household, you can choose to link your AH account on
              the Automated ordering tab. The app then stores an <strong>encrypted AH login token</strong>, when it was linked and when it
              was last used. We never see or store your AH password: you log in on Albert Heijn's own page.
            </p>
            <p className="mt-2">
              The token is used only to add items to your household's AH shopping list. The app never removes items,
              and never places orders or makes payments: you check out in the AH app yourself. Albert Heijn receives the
              list items the app adds to your account. The token is encrypted with a key that is kept outside our
              database.
            </p>
            <p className="mt-2">
              With the link on, your household can also keep a list of <strong>staples</strong>: things you buy
              regularly, how many and how often. To find them, the app searches AH's product range through your link
              (search words are first sent to Google's Gemini API to put them into Dutch; nothing about you is sent)
              and keeps the product details it sees (name, pack size, price), which contain nothing about you. Staples
              belong to your household, everyone in it can see and change them, and they are deleted when you remove
              them or the household is deleted.
            </p>
            <p className="mt-2">
              Linking is based on your consent. You can withdraw it at any time by unlinking on the Automated ordering tab, which deletes
              the token immediately. We keep a log of linking, unlinking and token refreshes (who and when, never
              tokens or shopping contents) for 12 months.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">How long we keep it</h2>
            <p>
              Your data is retained for as long as your account is active. If you request
              deletion, your account and all associated data will be removed within 30 days.
              An Albert Heijn login token is kept only until you unlink, and is deleted together
              with your household. The log of AH link events is kept for 12 months.
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
              You have the right to access, correct, or delete the data we hold about you, and to
              withdraw consent for the Albert Heijn link at any time. To make a request, email{' '}
              <a href="mailto:chris@aps75.com" className="underline">
                chris@aps75.com
              </a>{' '}
              (or, as a backup,{' '}
              <a href="mailto:trashmanss@gmail.com" className="underline">
                trashmanss@gmail.com
              </a>
              ). We will respond within one month.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Data storage</h2>
            <p>
              Your data is stored on{' '}
              <a href="https://supabase.com" className="underline" target="_blank" rel="noreferrer">
                Supabase
              </a>
              , a hosted PostgreSQL database provider. Data is stored in the EU (West EU, Ireland).
              The app itself is hosted on Vercel, and uploaded recipe PDFs are read by Google's
              Gemini API.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  )
}
