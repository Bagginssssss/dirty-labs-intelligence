UPDATE sp_campaign_performance
SET ad_type = 'SBV'
WHERE campaign_id IN (
  SELECT id FROM campaigns WHERE campaign_name IN (
    'SB.NB.KT.VERT - Booster - NB KW - Store',
    'SB.CO.PT.VERT - Booster - Competitor PT - Store',
    'SB.BR.KT - Activewear - BR KW - Store',
    'SB.NB.KT - Activewear - NB KW - Store (cyclist)',
    'SB.BR.PT.VERT - Laundry - Branded PT - Store',
    'SB.NB.KT - Price Justification - NB KW - Store',
    'SB.NB.KT - Activewear - NB KW - Store (female)',
    'SB.NB.KT - Activewear - NB KW - Store (combat)',
    'SB.NB.KT - Activewear - NB KW - Store (yoga)',
    'SB.BR.KT.VERT - Laundry - Branded KW - Store',
    'SB.BR.KT - Price Justification - BR KW - Store',
    'SB.CO.KT.VERT - Laundry - Competitor KW - Store',
    'SB.CO.KT.VERT - Booster - Competitor KW - Store',
    'SB.NB.KT.VERT - Laundry - NB KW - Store',
    'SB.BR.KT.VERT - Booster - Branded KW'
  )
);

UPDATE sp_search_term_report
SET ad_type = 'SBV'
WHERE campaign_id IN (
  SELECT id FROM campaigns WHERE campaign_name IN (
    'SB.NB.KT.VERT - Booster - NB KW - Store',
    'SB.CO.PT.VERT - Booster - Competitor PT - Store',
    'SB.BR.KT - Activewear - BR KW - Store',
    'SB.NB.KT - Activewear - NB KW - Store (cyclist)',
    'SB.BR.PT.VERT - Laundry - Branded PT - Store',
    'SB.NB.KT - Price Justification - NB KW - Store',
    'SB.NB.KT - Activewear - NB KW - Store (female)',
    'SB.NB.KT - Activewear - NB KW - Store (combat)',
    'SB.NB.KT - Activewear - NB KW - Store (yoga)',
    'SB.BR.KT.VERT - Laundry - Branded KW - Store',
    'SB.BR.KT - Price Justification - BR KW - Store',
    'SB.CO.KT.VERT - Laundry - Competitor KW - Store',
    'SB.CO.KT.VERT - Booster - Competitor KW - Store',
    'SB.NB.KT.VERT - Laundry - NB KW - Store',
    'SB.BR.KT.VERT - Booster - Branded KW'
  )
);

UPDATE sp_targeting_report
SET ad_type = 'SBV'
WHERE campaign_id IN (
  SELECT id FROM campaigns WHERE campaign_name IN (
    'SB.NB.KT.VERT - Booster - NB KW - Store',
    'SB.CO.PT.VERT - Booster - Competitor PT - Store',
    'SB.BR.KT - Activewear - BR KW - Store',
    'SB.NB.KT - Activewear - NB KW - Store (cyclist)',
    'SB.BR.PT.VERT - Laundry - Branded PT - Store',
    'SB.NB.KT - Price Justification - NB KW - Store',
    'SB.NB.KT - Activewear - NB KW - Store (female)',
    'SB.NB.KT - Activewear - NB KW - Store (combat)',
    'SB.NB.KT - Activewear - NB KW - Store (yoga)',
    'SB.BR.KT.VERT - Laundry - Branded KW - Store',
    'SB.BR.KT - Price Justification - BR KW - Store',
    'SB.CO.KT.VERT - Laundry - Competitor KW - Store',
    'SB.CO.KT.VERT - Booster - Competitor KW - Store',
    'SB.NB.KT.VERT - Laundry - NB KW - Store',
    'SB.BR.KT.VERT - Booster - Branded KW'
  )
);

UPDATE campaigns
SET ad_type = 'SBV'
WHERE campaign_name IN (
    'SB.NB.KT.VERT - Booster - NB KW - Store',
    'SB.CO.PT.VERT - Booster - Competitor PT - Store',
    'SB.BR.KT - Activewear - BR KW - Store',
    'SB.NB.KT - Activewear - NB KW - Store (cyclist)',
    'SB.BR.PT.VERT - Laundry - Branded PT - Store',
    'SB.NB.KT - Price Justification - NB KW - Store',
    'SB.NB.KT - Activewear - NB KW - Store (female)',
    'SB.NB.KT - Activewear - NB KW - Store (combat)',
    'SB.NB.KT - Activewear - NB KW - Store (yoga)',
    'SB.BR.KT.VERT - Laundry - Branded KW - Store',
    'SB.BR.KT - Price Justification - BR KW - Store',
    'SB.CO.KT.VERT - Laundry - Competitor KW - Store',
    'SB.CO.KT.VERT - Booster - Competitor KW - Store',
    'SB.NB.KT.VERT - Laundry - NB KW - Store',
    'SB.BR.KT.VERT - Booster - Branded KW'
);
