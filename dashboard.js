const { BigQuery } = require('@google-cloud/bigquery');

function client() {
  return new BigQuery({
    projectId: process.env.GCP_PROJECT_ID,
    credentials: {
      client_email: process.env.GCP_CLIENT_EMAIL,
      private_key: process.env.GCP_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
  });
}

const P = () => `\`${process.env.GCP_PROJECT_ID}.saarthi`;
async function run(bq, sql) { const [rows] = await bq.query({ query: sql }); return rows; }

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({error:'GET only'});
  try {
    const bq = client();
    const p = P();
    const q = {
      funnel: `SELECT event_name, COUNT(*) event_count FROM ${p}.chat_events\` WHERE event_name IN ('chat_started','profile_started','profile_completed','paywall_shown','payment_initiated','payment_success') AND event_id != 'event_id' GROUP BY event_name`,
      revenue: `WITH success AS (SELECT DATE(TIMESTAMP(created_at)) month, CAST(amount AS FLOAT64) amount, gateway_txn_id, ROW_NUMBER() OVER(PARTITION BY gateway_txn_id ORDER BY TIMESTAMP(created_at)) rn FROM ${p}.transactions\` WHERE LOWER(status)='success' AND txn_id!='txn_id' AND DATE(TIMESTAMP(created_at)) BETWEEN '2026-03-01' AND '2026-08-31'), refunds AS (SELECT DATE(TIMESTAMP(created_at)) month, ABS(CAST(amount AS FLOAT64)) refund_amount FROM ${p}.transactions\` WHERE LOWER(status)='refund' AND txn_id!='txn_id' AND DATE(TIMESTAMP(created_at)) BETWEEN '2026-03-01' AND '2026-08-31') SELECT COALESCE(s.month,r.month) month, COALESCE(s.gross_revenue,0) gross_revenue, COALESCE(r.refunds,0) refunds, COALESCE(s.gross_revenue,0)-COALESCE(r.refunds,0) net_revenue FROM (SELECT month,SUM(amount) gross_revenue FROM success WHERE rn=1 GROUP BY month) s FULL OUTER JOIN (SELECT month,SUM(refund_amount) refunds FROM refunds GROUP BY month) r USING(month) ORDER BY month`,
      channels: `WITH pay AS (SELECT u.channel, COUNT(DISTINCT t.gateway_txn_id) payers, SUM(CASE WHEN LOWER(t.status)='success' THEN CAST(t.amount AS FLOAT64) ELSE 0 END) gross_revenue, SUM(CASE WHEN LOWER(t.status)='refund' THEN ABS(CAST(t.amount AS FLOAT64)) ELSE 0 END) refunds FROM ${p}.users\` u LEFT JOIN ${p}.transactions\` t ON u.user_id=t.user_id AND t.txn_id!='txn_id' GROUP BY u.channel) SELECT u.channel, COUNT(DISTINCT u.user_id) users, COUNT(DISTINCT IF(ce.event_name='chat_started',ce.user_id,NULL)) chat_started, COUNT(DISTINCT IF(ce.event_name='payment_success',ce.user_id,NULL)) paid_users, COALESCE(pay.gross_revenue,0)-COALESCE(pay.refunds,0) net_revenue FROM ${p}.users\` u LEFT JOIN ${p}.chat_events\` ce ON u.user_id=ce.user_id LEFT JOIN pay ON u.channel=pay.channel WHERE u.user_id!='user_id' GROUP BY u.channel,pay.gross_revenue,pay.refunds ORDER BY users DESC`,
      campaigns: `WITH ads AS (SELECT campaign_name,SUM(spend_inr) spend_inr,SUM(impressions) impressions,SUM(clicks) clicks FROM ${p}.meta_ads_daily\` WHERE date BETWEEN DATE '2026-03-01' AND DATE '2026-08-31' GROUP BY campaign_name), acq AS (SELECT utm_campaign campaign_name,COUNT(DISTINCT user_id) acquired_users FROM ${p}.users\` WHERE user_id!='user_id' GROUP BY utm_campaign), rev AS (SELECT u.utm_campaign campaign_name,COUNT(DISTINCT IF(LOWER(t.status)='success',t.gateway_txn_id,NULL)) payers,SUM(CASE WHEN LOWER(t.status)='success' THEN CAST(t.amount AS FLOAT64) WHEN LOWER(t.status)='refund' THEN -ABS(CAST(t.amount AS FLOAT64)) ELSE 0 END) net_revenue FROM ${p}.transactions\` t JOIN ${p}.users\` u USING(user_id) WHERE t.txn_id!='txn_id' GROUP BY campaign_name) SELECT a.campaign_name,acq.acquired_users,a.impressions,a.clicks,a.spend_inr,COALESCE(r.payers,0) payers,COALESCE(r.net_revenue,0) net_revenue,SAFE_DIVIDE(a.spend_inr,acq.acquired_users) cac_inr,SAFE_DIVIDE(r.net_revenue,a.spend_inr) roas,SAFE_DIVIDE(r.payers,acq.acquired_users) payer_rate FROM ads a JOIN acq ON a.campaign_name=acq.campaign_name LEFT JOIN rev r ON a.campaign_name=r.campaign_name ORDER BY roas DESC`,
      retention: `WITH cohorts AS (SELECT user_id,DATE_TRUNC(DATE(TIMESTAMP(first_seen_at)),WEEK(MONDAY)) cohort_week FROM ${p}.users\` WHERE user_id!='user_id'), activity AS (SELECT DISTINCT user_id,DATE_TRUNC(DATE(TIMESTAMP(event_ts)),WEEK(MONDAY)) activity_week FROM ${p}.chat_events\` WHERE event_name='chat_started' AND event_id!='event_id'), a AS (SELECT c.cohort_week,x.user_id,DATE_DIFF(x.activity_week,c.cohort_week,WEEK(MONDAY)) week_number FROM cohorts c JOIN activity x USING(user_id) WHERE DATE_DIFF(x.activity_week,c.cohort_week,WEEK(MONDAY)) BETWEEN 0 AND 4), sizes AS (SELECT cohort_week,COUNT(DISTINCT user_id) cohort_users FROM cohorts GROUP BY cohort_week) SELECT a.cohort_week,a.week_number,COUNT(DISTINCT a.user_id) active_users,s.cohort_users,SAFE_DIVIDE(COUNT(DISTINCT a.user_id),s.cohort_users) retention_rate FROM a JOIN sizes s USING(cohort_week) GROUP BY a.cohort_week,a.week_number,s.cohort_users ORDER BY a.cohort_week,a.week_number`,
      costs: `SELECT is_paid_session,COUNT(DISTINCT session_id) sessions,SUM(cost_usd) total_cost_usd,SAFE_DIVIDE(SUM(cost_usd),COUNT(DISTINCT session_id)) avg_cost_per_session_usd FROM ${p}.llm_costs\` WHERE date BETWEEN DATE '2026-03-01' AND DATE '2026-08-31' GROUP BY is_paid_session ORDER BY is_paid_session DESC`,
      quality: `SELECT COUNT(*) post_period_refund_events,SUM(ABS(CAST(amount AS FLOAT64))) post_period_refund_amount FROM ${p}.transactions\` WHERE LOWER(status)='refund' AND TIMESTAMP(created_at)>TIMESTAMP('2026-08-31 23:59:59')`
    };
    const entries = await Promise.all(Object.entries(q).map(async ([k,sql])=>[k,await run(bq,sql)]));
    return res.status(200).json(Object.fromEntries(entries));
  } catch(e) { console.error(e); return res.status(500).json({error:e.message}); }
};
