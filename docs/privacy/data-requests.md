# Handling data requests

How we handle requests from people exercising their GDPR rights. Engineering procedure, not legal advice.

- **Primary:** Chris (chris@aps75.com)
- **Backup:** David (trashmanss@gmail.com). Takes over if the primary is unavailable for more than 7 days.
- **Deadline:** one month from receipt (the privacy policy promises 30 days). Can be extended by two further months for complex requests, if the requester is told why within the first month.

## 1. Receive

Requests can arrive at either inbox. Whoever receives one forwards it to the other and logs it the same day.

## 2. Verify

Confirm the request comes from the account holder before acting:

- Reply to the email address the account signs in with, and ask them to confirm.
- Never send data to a different address than the account's.
- If identity cannot be confirmed, say so and pause the clock until it is.

## 3. Act

| Request | What we do |
|---|---|
| **Access / portability** | Run the export function for the user and their household. Send the JSON file to the account email. |
| **Rectification** | Fix the data, or point them to the in-app setting that does it. |
| **Erasure, one member** | Delete their profile, push subscriptions and household membership. Remove their identity from audit events. Shared household data (staples, mappings) stays with the household. If they linked AH, unlink it and delete the token. |
| **Erasure, last member or whole household** | Delete the household. Cascades to all household data and deletes the AH token. |
| **Restriction / objection** | Turn off the household's automation and unlink AH. Keep data until the matter is resolved. |
| **Complaint** | Tell them they can complain to the Autoriteit Persoonsgegevens (autoriteitpersoonsgegevens.nl). |

Deleting data in this app does not delete anything held by Albert Heijn. Tell the requester to contact AH for that.

## 4. Log

Record each request in `private.data_requests` (once the migration exists; until then, in a private note outside this public repo):

- Request type, date received, date verified, date completed, outcome, handled by.
- No request contents, no personal data beyond what is needed to show the request was handled.

Logs are kept for 3 years.

## 5. Confirm

Email the requester when done, saying what was done. For erasure, confirm within the deadline.
