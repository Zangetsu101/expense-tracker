# Category cleanup

Status: category review complete and approved migration applied to the Expo emulator. Native restore and same-CSV reimport were verified by full backup comparison. Unclear/deferred entries retained unchanged. Private execution evidence: .private/category-cleanup/result.md. Transfer review is separate and unconfirmed.

## Approved decisions

- For new food entries, use Groceries and Eating out & drinks. No Café/Snacks/meal-time subdivisions needed.
- Existing historical Food & Beverage and other ambiguous entries require evidence or user approval before reclassification; the two-category choice is not permission to guess missing purchase purposes.
- Transport has children Public transport, Taxi/rideshare, and Vehicle costs. User owns a vehicle and confirmed existing Maintenance refers to vehicle maintenance, not home repairs. Vehicle costs covers fuel, parking, maintenance and repairs.

- Home has children Rent, Utilities, Furnishings & equipment, and Home services. Furnishings & equipment replaces the earlier Household goods proposal and covers furniture, household appliances, kitchenware, decor and household tools. Historical Home Improvement maps here where consistent; identifiable home appliances from Electronics also belong here. Home repairs and installation belong in Home services.
- Home / Utilities has children Electricity, Internet, Phone, and Gas. Historical Gas Bill maps to Gas.
- Home / Home services has children Housekeeping and Laundry. Historical entries identified by the Khala label belong in Housekeeping; historical Laundry maps to Laundry. Other home services, such as repairs, remain under Home services unless a further subdivision is agreed.

- Shopping has children Clothing & accessories and Electronics. Existing Footwear belongs in Clothing & accessories, together with Clothing and Accessories. Electronics is for personal tech and accessories, not household appliances. Mixed purchases require review rather than assigning the whole amount by one keyword.
- Personal care has child Salon. Historical Personal Care means salon/barber spending and maps to Personal care / Salon. No other Personal care children for now; Salon is a service, not Shopping.

- Gifts & support has children Gifts given, Charity, and Family support. Historical Family mostly represents financial support; review contradictory notes rather than assuming every historical entry is support.
- Income categories: Salary, Interest, Gifts received, Cashback, Selling, Other income, and Award (awards/bonuses). Historical Interest Money maps to Interest. Transfer-like receipts, refunds and reimbursements require separate review; they are not automatically earnings or gifts.

- Health has children Medicine, Medical care, and Fitness & sports. Historical Meds maps to Medicine. Sports and Health & Fitness map to Fitness & sports; inspect contradictory notes rather than assuming every ambiguous purchase is exercise.

- Subscriptions is a root with children Entertainment and Software & services. Entertainment covers streaming and entertainment-focused memberships; Software & services covers AI tools, cloud storage and apps. Classify memberships such as Patreon by purpose only where known. Historical Subscriptions and explicit subscription notes in other categories are migration candidates, not permission to guess unknown purpose. Television Bill is not automatically a subscription: hardware belongs in Home / Furnishings & equipment and installation in Home / Home services.

- Education & learning has children Books and Courses. General education expenses such as IELTS may stay directly under Education & learning.
- Entertainment is a root for non-subscription leisure, such as cinema and arcades; recurring entertainment services belong in Subscriptions / Entertainment.

- Stationery is a standalone category covering printing, files, pens, paper and similar supplies. Rename historical Stationary to Stationery.

- Historical supplementary-card bills usually represent the wife's purchases, paid by the user without reimbursement. Her individual purchases were generally not recorded; the bill is often the sole spending record. Preserve that spending and do not bulk-exclude or convert these bills to Transfers. User's own card purchases were recorded separately with missing purchases reconciled at billing cycle end. Mixed own/supplementary bills require individual review to prevent double-counting.
- Credit-card Account workflow is explicitly deferred for separate closer review. Do not create credit-card Accounts, convert historical card bills to Transfers, or change the current card-entry workflow during category cleanup.
- Household spending / Supplementary card is approved for historical card-bill entries explicitly mentioning Progga. The name alone in unrelated purchases is not enough; use card-bill context. Other card-bill entries remain unchanged pending review.

- Historical entries explicitly marked adjust balance become Balance adjustment, excluded from ordinary spending/income reports while retaining signed Account movements and amounts. Keep separate Expense/Income category records as required by existing type constraints. This applies to explicit correction evidence, not arbitrary Other Expense/Other Income. For future entry, known missing purchases remain ordinary categorized Expenses; unidentified reconciliation differences use Balance adjustment with an explanatory note.

- Use tags for trips and weddings rather than event-based categories for new entries. Categories describe purchase purpose (transport, food, clothing, gifts, etc.). Historical Travel/Marriage entries may migrate only when purpose is supported; preserve event context as tags and leave uncertain entries unchanged.

- Historical Treat maps to Eating out & drinks as explicitly approved. Identifiable flower entries in Friends & Lover map to Gifts & support / Gifts given; other entries there need evidence before migration.

- Investment accounting is deferred. Preserve existing Investment entries, Categories, Account effects and report flags during this cleanup; do not infer Transfers or change reporting based on asset-purchase notes.

- Historical Restaurants, Dinning, Snacks, Breakfast, and Café all map to Eating out & drinks. User explicitly approved the 497-transaction consolidation after reviewing the dry-run summary. Include in the approved migration plan; live application remains separate from dry-run approval.

- Historical Rickshaw maps to Transport / Taxi/rideshare (544 transactions in the pinned dry-run dataset). User approved hiring-a-ride treatment rather than Public transport. Live application remains pending.

- Historical Bus and Gulshan Chaka map to Transport / Public transport; Taxi maps to Transport / Taxi/rideshare; Petrol and Parking Fees map to Transport / Vehicle costs. User explicitly approved these historical mappings after the dry run (1,171 transactions). Broad Transportation remains subject to evidence-based review.

- Vehicle costs has children Fuel, Repairs & maintenance, and Parking. These refine and supersede earlier direct-to-Vehicle-costs mappings: historical Petrol maps to Transport / Vehicle costs / Fuel, Maintenance to Transport / Vehicle costs / Repairs & maintenance, and Parking Fees to Transport / Vehicle costs / Parking.
- Historical Electricity Bill, Internet Bill and Phone Bill map to the corresponding Home / Utilities children; Doctor maps to Health / Medical care; Charity maps to Gifts & support / Charity; Books maps to Education & learning / Books; Education maps to Education & learning. User approved these historical mappings after the dry run.

- Historical Movies and Games map to Entertainment. Any explicitly identifiable entertainment subscription instead maps to Subscriptions / Entertainment; mixed or unclear subscription evidence needs review. User approved this historical mapping.

- Historical Subscriptions entries explicitly labelled Claude, ChatGPT, Claude and ChatGPT, or Patreon map to Subscriptions / Software & services. User explicitly approved Patreon in this group; do not infer the purpose of other membership labels from this approval. These cover all 15 current Subscriptions entries.

- Historical Rentals represents home rent and maps to Home / Rent. User confirmed home, not vehicle/equipment rentals. Preserve mixed rent/utility notes without splitting amounts; flag those entries for visibility in the dry-run report.

- Banking & payment fees is approved for identifiable account maintenance, transfer fees, card/SMS charges and bank excise duty. Use exact whole-note evidence within historical Fees & Charges; do not blanket-map that mixed category. Tolls, household services, generic taxes and other unclear fees remain for review.

- Exact historical Bua and Maid notes map to Home / Home services / Housekeeping, and exact Garbage notes map to Home / Home services, within household-related Bills & Utilities, Fees & Charges, Home Expenses or Home Services. User approved these explicit household-note mappings. Mixed notes such as Rent, dues, Bua, wifi remain unchanged.

- Mixed purchases may map directly to their deepest shared approved parent when every component clearly belongs under it; do not invent splits. Explicit Rent, dues, Bua, wifi maps to Home. Purchases spanning different roots, or containing unclear components, remain for review. This refines earlier mixed-note preservation rules only where the shared parent is supported by all components.

- User confirmed Food & Beverage was generally prepared food, snacks and drinks, not cooking groceries. The 1,363 unnoted Food & Beverage entries map to Eating out & drinks; explicit grocery exceptions retain their approved Groceries mapping and contradictory/mixed notes remain for review.
- User confirmed chicken, fish, beef, rice and oil notes in Home Expenses generally represent groceries for home cooking. Exact whole-note chicken, fish, beef, rice, oil and meat in Home Expenses map to Groceries; do not extend this assumption to restaurant-context notes in other categories.

- Home / Household supplies covers both toiletries and cleaning consumables, including soap, shampoo, toothpaste, detergent, tissues and insect repellent. Do not create a separate Toiletries category because purchases are commonly combined. Durable household items stay in Furnishings & equipment. Historical exact whole-note evidence for these supplies in Home Expenses or Shopping may migrate; mixed food/supplies entries need shared-parent review rather than automatic splitting.

- Groceries is a child of Home, superseding the earlier standalone Groceries proposal. All approved grocery mappings target Home / Groceries. Clear mixed grocery-and-household-supply purchases may map directly to Home under the deepest-shared-parent rule; unclear components or personal electronics still require review.

- Historical Family entries with no note or simple exact to-person notes map to Gifts & support / Family support. Approved current to-person labels: to Progga, to Boro Mama, to Ammu, to Shejo Mama, to Lia (case-insensitive). Specific purchases such as cake, books and design work remain for review; other bare names are not inferred by this rule.
- Historical Gifts & Donations generally represents gifts given, with charity recorded separately. Map this category to Gifts & support / Gifts given.
- Historical income Gifts with exact Cashback or Cashback from Eid purchases notes map to Cashback (50 current entries). Received from named own-account notes remain unchanged for transfer review, not Gifts received.

- Remaining Family labels Boro Mama, Dida, and Apu map to Gifts & support / Family support; Progga's cake maps to Gifts & support / Gifts given; Boi mela maps to Education & learning / Books. User explicitly confirmed these placements.
- Family / Structure design was building/home planning. Classify as Home / Home services, preserving the note; it is not family financial support. No separate planning/design child proposed yet.

- Historical Transportation with no note maps directly to Transport (914 current entries). Other notes need evidence; do not infer a transport mode from destinations. Explicit Uber, Uber (extra), and Rickshaw notes in Transportation map to Transport / Taxi/rideshare.
- Add Transport / Vehicle costs / Tolls. Explicit Toll or Tolls notes in Transportation or Fees & Charges map there. Delivery/carrying or unclear purchase-context notes are reviewed separately, not presumed travel.

- Delivery & moving is a standalone category. Historical Transportation entries explicitly labelled Parcel, Bean delivery, Delivery, Carrying, or Moving map there. Mixed/unclear item-only notes such as Computer table or glass lids remain for review. Destination-only trips and CNG were proposed for Transport and Taxi/rideshare respectively, but this approval only settled Delivery & moving.

- User approved destination-only Transportation trips mapping directly to Transport and CNG mapping to Transport / Taxi/rideshare. Transportation notes Computer table and glass lids were confirmed delivery charges and map to Delivery & moving, not household-item purchase categories. This supersedes their earlier review status.

- Transportation / Wedding (Rent a car advance) maps to Transport / Taxi/rideshare AND receives a Wedding tag, explicitly approved by user. Preserve original note and existing tags. This authorizes adding that tag/link in the eventual executor and dry-run clone, superseding the blanket tag-immutability rule for this one identified entry only. Do not move it without preserving wedding context as a tag.
- Transportation / Nanu der transport was payment for their ride and maps to Transport / Taxi/rideshare, not financial support.

- Latest batch answers: unnoted Home Expenses maps directly to Home; unnoted Shopping stays Shopping. Unnoted Electronics maps to Shopping / Electronics without individual review. Unnoted Gifts income maps to Gifts received, while own-account receipts remain for transfer review.
- Unnoted Television Bill represents cable/TV service and maps to Subscriptions / Entertainment, not hardware. Explicit hardware/installation notes retain their separate treatment.
- Unnoted Fees & Charges must be reviewed separately; user explicitly rejected presuming banking fees.
- Add Transport / Air travel and standalone Accommodation for explicit flights and hotel/resort stays, preserving identifiable trip context with tags. Other destinations alone do not prove air travel. Detailed historical rule list still needs inspection before expanding the dry run.
- Add standalone Taxes and Legal services for clearly identified tax/legal costs. Do not override the previously approved treatment of bank excise duty as Banking & payment fees. Mixed tax/lawyer amounts require shared-purpose review, not invented splits.

- Remaining Fees & Charges table approved: explicit card renewal/SMS, cheque deposit, transfer fees, statements, chequebook, NPSB and account maintenance map to Banking & payment fees; explicit education application/admission/exam/certificate fees map to Education & learning; Internet, khala maps to Home; Grabage maps to Home / Home services; Tax on interest maps to Taxes. Thailand visa stays Fees & Charges with Thailand tag; Marriage Registration maps to Legal services with Wedding tag. Tax token maps to Transport / Vehicle costs per approved table, with annual-vehicle-tax clarification still pending. Registration fee (Bkash, 2025-01-31, BDT 100) and Sanjay (Bkash, 2021-12-16, BDT 106) are explicitly left unchanged because user cannot identify them; unnoted fees stay Fees & Charges. These new tag approvals extend the earlier single-tag exception, preserving all existing tags and original notes.

- Other Income review: unnoted entries stay unchanged; explicit ticket refunds and ticket-cancellation receipts map to income Refunds, not Cashback. User confirmed cake dividends, burger money and the five Rabiul vai headphone contributions are reimbursements for shared purchases; map those exact notes to income Reimbursements. Shoumita Apu's Gift maps to Gifts received. Preserve existing report flags for Refunds and Reimbursements; reporting/netting is separate review. Initial Balance, Rocket, From bkash and withdrawal-related receipts remain unchanged for balance/transfer review.

## Final review approval

- User confirmed the remaining clear-purchase batch: prepared meals/snacks/drinks to Eating out & drinks; cooking ingredients and packaged groceries to Home / Groceries; furniture, curtains, kitchenware, filters and household equipment to Home / Furnishings & equipment; toiletries/cleaning consumables to Home / Household supplies; mixed groceries/household goods to Home; installation/key copying to Home / Home services; explicit delivery/carrying to Delivery & moving; personal tech/accessories to Shopping / Electronics; bags/clothing accessories to Shopping / Clothing & accessories; explicit flights to Transport / Air travel; hotels/resorts to Accommodation. Use inspected whole-note evidence, not loose substring matches. Mixed cross-root purchases still need review.
- Preserve identifiable trip and wedding context with tags for these approved movements, preserving notes and existing tags. Do not fabricate trip identity for generic tickets or lodging.
- Team dinner income (BDT 10,560, 2023-12-05) is confirmed reimbursement and maps to Reimbursements with original report flag preserved.
- Tax token (BDT 2,334, 2025-06-22) is confirmed annual vehicle tax; maps to Transport / Vehicle costs, preserving its note.
- User approved retaining all still-unclear entries in existing Categories with existing report flags, including unnoted fees, uncertain mixed purchases, unnamed payments/top-ups, generic income/expenses and potential transfers. Investments and credit-card accounting remain deferred. These retained entries are a completed preservation decision, not a blocker to category cleanup.

## Deferred or preserved scope

- Historical grocery migration is approved for clear whole-note grocery evidence in Home Expenses, Shopping, and Food & Beverage. Use a conservative explicit allowlist of groceries, produce, staple ingredients and unambiguous grocery-only combinations. Leave unnoted, mixed food/non-food and unclear prepared-food purchases unchanged.
- Treatment of unspecified card bills and remaining categories. Confirm historical migration scope before applying cleanup.

Preserve financial amounts, dates, Accounts, report exclusions, lending associations and MoneyLover import identities through cleanup. Keep private transaction examples and mappings under Git-ignored .private/.
