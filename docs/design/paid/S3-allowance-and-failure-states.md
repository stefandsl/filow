# S3 Allowance and failure states

Proposal against main `d320837`, 2026-11-14; PLAN.md v6 sections 4, 5b, 5c, 6, 8. Depends on S2's proposed contract. Copy below is exact proposed EN/IT copy, not text already shipped. Implementation must add ru/ro/ja as well, following the five-language rule. Never render raw provider or payment errors.

## Current seam and proposed account data

Read `apps/cloud/service.mjs`: `handle()` currently returns `{user:{email,name},plan,paidUntil,billing}` from `/v1/me`, with `paidSubscription()` as its only entitlement test. `apps/desktop/account.js` `status()` adds `configured` and `service`, clears an invalid session on 401 and otherwise propagates failure. `apps/web/app/account/page.tsx` `AccountPage()`/`refresh()` show sign-in, a plan label, checkout/portal, refresh and sign-out; `act()` maps errors to one generic message. There is no allowance display. Use this page and bridge, not a second billing UI.

Proposed additive `/v1/me` fields (UTC ISO timestamps, nonnegative integer counts, nullable where unknown):

```text
user, plan, paidUntil, billing                  existing, retain compatibility
serverTime, statusRevision                     freshness and ordering
liveBilling: boolean                           checkout open, distinct from billing configured
subscription: {status, cancelAtPeriodEnd, periodEnd, graceEndsAt}
entitlement: {source: local|paid|trial|pilot, eligible, reason}
allowance: null | {unit: answers, limit, counted, inflight, remaining,
                  windowStart, windowEnd}
trial: {enabled, eligible, state: unused|active|expired|used, endsAt}
assist: {enabled, state, retryAt, minVersion,
         provider: {id, recipientId, names}, supportUrl}
```

`remaining = max(0, limit-counted-inflight)` is what can start now. Label it as answers left and separately show reserved requests; release restores availability, commit does not decrement twice. Never calculate entitlement from these fields in the PC: `/v1/assist` checks again. Preserve existing `plan:'pro'|'local'`; use `entitlement.source` for trial/pilot rather than pretending they are subscriptions. No provider keys in this response.

`assist.state` is one primary service state: `ready`, `subscription_required`, `trial_expired`, `allowance_exhausted`, `payment_required`, `update_required`, `daily_cap_reached`, `paid_route_off`, `account_blocked`, `provider_unavailable`, `billing_unavailable`. Include independent subscription/allowance fields so a pause cannot hide a failed payment. A 401 synthesizes signed-out; a failed network request synthesizes service unavailable with an old-data label. `no_local_model` comes from the local model scan, never `/v1/me`. Offline comes from desktop settings; local model availability is not uploaded.

Refresh on account open, sign-in, checkout/portal return, each settled/interrupted answer, and a manual refresh. Refresh while the page is visible at a proposed 60-second interval; do not poll during Offline. Apply only increasing statusRevision. After 60 seconds without a successful refresh mark the cached count stale and show no fabricated zero. Service/provider status indicates observed health, not a promise about the next request.

## Exact state copy and placement

Dates such as `{date}` use the interface locale and show the timezone for reset/payment deadlines. Each row is plain text with an accessible status region; important failures also appear beside the affected answer, not only in Settings. A local alternative is shown only if available; otherwise link to local setup. Nothing changes routes automatically.

| State / data | English | Italiano | Placement and action |
|---|---|---|---|
| Ready, allowance.remaining | Answers left: {n} | Risposte rimaste: {n} | Account card and managed-mode selector; example: Answers left: 12 / Risposte rimaste: 12. |
| Window end | Your next allowance starts on {date}. | Le prossime risposte saranno disponibili dal {date}. | Under count; show only when renewal/continued eligibility supports it. |
| Inflight > 0 | Answers in progress: {n} | Risposte in corso: {n} | Under count; explains reservations. |
| Zero, `allowance_exhausted` | You have used the answers for this period. You can use answers on this PC or check your plan. This period ends on {date}. | Hai usato le risposte di questo periodo. Puoi usare le risposte su questo PC o controllare il piano. Il periodo termina il {date}. | Account and failed question; Use this PC / Usa questo PC; View plan / Vedi il piano. Do not promise renewal after cancellation. |
| Failed payment, `subscription.status=past_due`, grace still active | The payment did not go through. You can keep using paid answers until {date}. You can update your payment details here. | Il pagamento non è andato a buon fine. Puoi continuare a usare le risposte a pagamento fino al {date}. Puoi aggiornare qui i dati di pagamento. | Account persistent banner; managed selector notice; Update payment details / Aggiorna i dati di pagamento. Count remains visible. |
| Failed payment, `payment_required`, grace ended | Paid answers are paused because the payment did not go through. You can update your payment details or use answers on this PC. | Le risposte a pagamento sono in pausa perché il pagamento non è andato a buon fine. Puoi aggiornare i dati di pagamento o usare le risposte su questo PC. | Account and answer failure; same portal action. No blame or debt language. |
| 426, `update_required`, minVersion | A Filow update is needed for paid answers. Update Filow to continue. Answers on this PC are still available if set up. | Serve un aggiornamento di Filow per le risposte a pagamento. Aggiorna Filow per continuare. Le risposte su questo PC restano disponibili se configurate. | Account and question; Update Filow / Aggiorna Filow. Version shown in details, not as the explanation. |
| `daily_cap_reached`, retryAt | Paid answers are paused for today. You can try again after {date} or use answers on this PC. | Le risposte a pagamento sono in pausa per oggi. Puoi riprovare dopo il {date} o usare le risposte su questo PC. | Account and question; no upgrade button implying payment bypasses server cap. |
| `paid_route_off` | Paid answers are temporarily paused. You can use answers on this PC while we restore the service. | Le risposte a pagamento sono temporaneamente in pausa. Puoi usare le risposte su questo PC mentre ripristiniamo il servizio. | Account and question; no invented recovery time. |
| `account_blocked` | Paid answers are paused for this account. Contact us privately so we can help. | Le risposte a pagamento sono in pausa per questo account. Contattaci in privato per ricevere assistenza. | Account and question; Contact support / Contatta l'assistenza. Portal/cancellation remain accessible. |
| Service down, network error or `service_unavailable` | Filow's online service is not reachable right now. Please try again later. You can still use answers on this PC if set up. | Il servizio online di Filow non è raggiungibile al momento. Riprova più tardi. Puoi comunque usare le risposte su questo PC se configurate. | Account error region and question. Retry / Riprova is an explicit action. |
| `provider_unavailable` or `provider_timeout` before count | The answer service is not responding right now. This attempt did not use an answer. Please try again later. | Il servizio delle risposte non risponde al momento. Questo tentativo non ha consumato una risposta. Riprova più tardi. | Question and account health banner. Use the no-charge sentence only with confirmed counted=false. |
| No local model, local scan | Answers on this PC are not set up yet. You can set them up in Local models. | Le risposte su questo PC non sono ancora configurate. Puoi configurarle in Modelli locali. | Account local fallback and onboarding; Set up local answers / Configura le risposte locali. If hardware cannot fit one, explain that separately below. |
| Local model cannot fit, hardware result | This PC does not currently have enough memory or free space for local answers. You can check setup options. | Questo PC al momento non ha memoria o spazio libero sufficienti per le risposte locali. Puoi controllare le opzioni di configurazione. | Local setup and fallback; never advertise a download guaranteed to fail. |
| No subscription, `subscription_required` | Managed answers need a subscription. You can view the plan or keep using local features. | Le risposte gestite richiedono un abbonamento. Puoi vedere il piano o continuare a usare le funzioni locali. | Account and managed selection; View plan only when checkout is open. |
| Active trial, trial endsAt | Trial answers left: {n}. Your trial ends on {date}. | Risposte di prova rimaste: {n}. La prova termina il {date}. | Account, onboarding and mode selector. No automatic renewal wording for the proposed no-card trial. |
| Trial expired or used | Your trial has ended. You can view the plan or set up answers on this PC. | La prova è terminata. Puoi vedere il piano o configurare le risposte su questo PC. | Account and onboarding; never imply local features expired. |
| Signed out | Sign in to see your plan and answers left. | Accedi per vedere il piano e le risposte rimaste. | Account and managed selector; Sign in / Accedi. |
| Offline, local setting | Offline mode is on. Managed answers are available only when you choose to go online. | La modalità offline è attiva. Le risposte gestite sono disponibili solo quando scegli di andare online. | Selector and account; no network refresh or automatic setting change. |
| `billing_not_open`, liveBilling=false | Subscriptions are not open yet. Local features are available without an account. | Gli abbonamenti non sono ancora disponibili. Le funzioni locali sono disponibili senza un account. | Account; hide checkout, retain portal for existing customers. |
| `billing_unavailable` | We cannot check your plan right now. Please try again later. | Non riusciamo a verificare il piano al momento. Riprova più tardi. | Account and managed selection; do not show Local as if subscription was lost. |
| `provider_changed` / `consent_required` | The answer service has changed. Review who will receive your question before sending it. | Il servizio delle risposte è cambiato. Controlla chi riceverà la domanda prima di inviarla. | Pre-send notice; Review recipients / Controlla i destinatari. No automatic resend. |
| `request_in_progress` | This question is already being answered. | È già in corso una risposta a questa domanda. | Question; wait/cancel existing stream, no new id generated automatically. |
| `request_closed` | This request has ended. Check your answers left before asking again. | Questa richiesta è terminata. Controlla le risposte rimaste prima di fare un'altra domanda. | Question; refresh account. |
| 429 limiter/quota | The service is busy right now. Please try again shortly. This attempt did not use an answer. | Il servizio è occupato al momento. Riprova tra poco. Questo tentativo non ha consumato una risposta. | Question; respect Retry-After; only if counted=false. |
| Stream cut, counted=true | The answer was interrupted after it started. It used one answer. Asking again will use another answer. | La risposta si è interrotta dopo l'inizio. Ha consumato una risposta. Chiedere di nuovo consumerà un'altra risposta. | Beside preserved partial answer; stop queued voice and marks; no silent retry. |
| Lost connection, charge unknown | The connection was interrupted. We are checking your answers left. | La connessione si è interrotta. Stiamo verificando le risposte rimaste. | Partial answer; refresh, then show updated count without claiming which request committed if not known. |
| Stale count | Last checked: {date}. Answers left may have changed. | Ultimo controllo: {date}. Il numero di risposte rimaste potrebbe essere cambiato. | Account under cached count. |
| Cancel at end, cancelAtPeriodEnd=true | Your subscription ends on {date}. You can use your remaining answers until then. | L'abbonamento termina il {date}. Puoi usare le risposte rimaste fino a quella data. | Account; no next-allowance promise. |

The payment-grace message must use the earlier of the valid grace deadline and any entitlement revocation. A refund, dispute or immediate cancellation changes entitlement immediately, even if the display still has an old window. Precedence for a question: Offline, sign-in, update, account block, global pause, provider/billing health, entitlement, allowance, capacity. Show independent payment/cancellation banners on the account page regardless of this primary error.

## Account page wireframe

```text
Filow                                      Back / Indietro
Account & plan / Account e piano
email@example.test                         Sign out / Esci

Managed answers / Risposte gestite          [plan or trial]
Answers left: 12 / Risposte rimaste: 12
Answers in progress: 1 / Risposte in corso: 1
[period end, trial end or cancellation date]
[payment notice, if any]                    [Update payment details]
[primary service status, if any]            [contextual action]
[Subscribe OR Manage subscription]         [Refresh / Aggiorna]
[what one answer means, interruptions count, approved price and limit]

Where your question goes / Dove viene inviata la domanda
Filow's server -> actual provider names     [Review permission]

On this PC / Su questo PC
[ready, missing model, or hardware limit]   [Use this PC / Set up]

[Private support] [Export my data] [Delete account]
[Terms] [Privacy]                           [Try the guided tour]
```

Export/deletion links depend on S5's implemented manual process, not dead buttons. Checkout pending says payment confirmation is being checked; a success redirect alone never unlocks answers. Keep sign-out visible when billing is unavailable. Restore keyboard focus after a consent notice; counts and errors use text and numbers, not colour alone. Test both themes and a narrow viewport at implementation time.

## Owner branches and differences from the plan

With no trial, remove trial rows entirely and show local setup first (F1). With a trial, distinguish trial from recurring allowance and show the no-card/no-automatic-conversion terms if that proposal is approved. Answers versus money is unresolved: recommended answers preserves every label here; a money unit requires new labels, precision and pricing rules. Broader subscription scope requires an explicit list above checkout. Stripe versus a merchant of record changes the portal destination and payment wording only after the actual flow is verified; never hard-code an unselected processor as a recipient.

v6 requires these states but current `/v1/me` has no fields for them and the account page collapses failures. Grace is not implemented; `paidSubscription()` currently rejects `past_due`. Service-down cannot reliably come from a service that is unreachable, and local model availability cannot come from the hosted account response. These are deliberate client-derived states. No screenshots, live UI tests or copy implementation were performed for this documents-only task.

Judge: render every row with fixture data in both languages, dark/light and keyboard use; assert the exact count and localized deadline; test stale responses, simultaneous devices, portal return without webhook, 426, all pause states, unavailable local fallback and all three stream charge outcomes. Fail any test that displays a payment or no-charge assertion without the supporting server state.
