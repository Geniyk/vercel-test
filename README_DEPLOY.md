# Saarthi dashboard deployment

## Vercel
1. Upload this folder to GitHub.
2. Import the repo into Vercel.
3. Add these Vercel Environment Variables:
   - `GCP_PROJECT_ID` = your Google Cloud project ID
   - `GCP_CLIENT_EMAIL` = service account email
   - `GCP_PRIVATE_KEY` = `private_key` from the service-account JSON; preserve line breaks as `\\n`.
4. Give the service account `BigQuery Job User` on the project and `BigQuery Data Viewer` on dataset `saarthi`.
5. Deploy.

The browser only renders results returned by `/api/dashboard`. All joins and aggregations used by the dashboard execute in BigQuery.
