
const { fields } = require('./fields');
//console.log("query-builder: fields="+JSON.stringify(fields));
// Aggregations used to build the different parts of the UI
const moment = require('moment');
// ISO 8601 date format accepted by the service
const ISO_8601 = 'YYYY-MM-DDThh:mm:ssZZ';

const entities = [
  `nested(${fields.title_entity}).filter(${fields.title_entity_type}:Company).term(${fields.title_entity_text})`,
  `nested(${fields.title_entity}).filter(${fields.title_entity_type}:Person).term(${fields.title_entity_text})`,
  `term(${fields.title_concept_text})`,
];

const sentiments = [
  `term(${fields.host}).term(${fields.text_document_sentiment_type})`,
  `term(${fields.text_document_sentiment_type})`,
  `min(${fields.text_document_sentiment_score})`,
  `max(${fields.text_document_sentiment_score})`,
];

const mentions = [
  // eslint-disable-next-line
  `filter(${fields.title_entity_type}::Company).term(${fields.title_entity_text}).timeslice(${fields.publication_date},1day).term(${fields.text_document_sentiment_type})`
];

module.exports = {
  aggregations: [].concat(entities, sentiments, mentions),
  entities,
  sentiments,
  mentions,
  build(query, full) {
	//console.log("query-builder.build(): query="+JSON.stringify(query));
    const params = {
      //count: 5,
	  count: 1,
      return: `${fields.title}, text, url, enriched_text.sentiment.document.label`,
	  //return: `text`,
	  //query: `${query.text},${fields.language}:(english|en)`
      query: `"${query.text}",${fields.language}:(english|en)`, // this line is orginal.
	  //filter: `enriched_text.concepts.text:"post",enriched_text.concepts.text:"etiquette"`
	  filter: `enriched_text.concepts.text:"post"`
	};
	//console.log("query-builder.build1");
    if (full) {
      params.aggregations = [].concat(entities, sentiments, mentions);
    }
    //if (query.date) {
    //  params.filter = `${fields.publication_date}>${moment(query.date.from).format(ISO_8601)},${fields.publication_date}<${moment(query.date.to).format(ISO_8601)}`;
    //}
	//console.log("query-builder.build2");
    if (query.sort) {
      params.sort = query.sort == 'date' ? `-${fields.publication_date},-_score` : '-_score';
    }
	//console.log("query-builder.build3");
	//console.log("query-builder.build(): params="+JSON.stringify(params));
    return params;
  },
};
