/**
 * Adds डॉकेट संख्या: {Docket_IDs} line to the three SMS templates
 * so all docket IDs appear in every sent message.
 */
exports.up = async (db) => {
  // FORMAT_1_DENIED: insert after Farmer_Mobile line
  await db.query(`
    UPDATE message_templates
    SET body_template = replace(
      body_template,
      E'किसान का मोबाइल नंबर: {Farmer_Mobile}\nप्रयास संख्या',
      E'किसान का मोबाइल नंबर: {Farmer_Mobile}\nडॉकेट संख्या: {Docket_IDs}\nप्रयास संख्या'
    ),
    updated_at = now()
    WHERE code = 'FORMAT_1_DENIED'
      AND body_template NOT LIKE '%{Docket_IDs}%'
  `);

  // FORMAT_2_POSTPONED
  await db.query(`
    UPDATE message_templates
    SET body_template = replace(
      body_template,
      E'किसान का मोबाइल नंबर: {Farmer_Mobile}\nप्रयास संख्या',
      E'किसान का मोबाइल नंबर: {Farmer_Mobile}\nडॉकेट संख्या: {Docket_IDs}\nप्रयास संख्या'
    ),
    updated_at = now()
    WHERE code = 'FORMAT_2_POSTPONED'
      AND body_template NOT LIKE '%{Docket_IDs}%'
  `);

  // FORMAT_3_WRONG_NUMBER
  await db.query(`
    UPDATE message_templates
    SET body_template = replace(
      body_template,
      E'किसान का मोबाइल नंबर: {Farmer_Mobile}\nप्रयास संख्या',
      E'किसान का मोबाइल नंबर: {Farmer_Mobile}\nडॉकेट संख्या: {Docket_IDs}\nप्रयास संख्या'
    ),
    updated_at = now()
    WHERE code = 'FORMAT_3_WRONG_NUMBER'
      AND body_template NOT LIKE '%{Docket_IDs}%'
  `);
};

exports.down = async (db) => {
  await db.query(`
    UPDATE message_templates
    SET body_template = replace(body_template, E'\nडॉकेट संख्या: {Docket_IDs}', ''),
        updated_at = now()
    WHERE code IN ('FORMAT_1_DENIED', 'FORMAT_2_POSTPONED', 'FORMAT_3_WRONG_NUMBER')
  `);
};
