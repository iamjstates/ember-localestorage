import JSONSerializer from 'ember-data/serializers/json';
import Ember from "ember";

const get = Ember.get;

export default JSONSerializer.extend({
  serializeHasMany: function(snapshot, json, relationship) {
    let key = relationship.key,
      kind = relationship.kind;

    if (kind === 'hasMany') {
      json[key] = snapshot.hasMany(key, { ids: true });
      // TODO support for polymorphic manyToNone and manyToMany relationships
    }
  },
  extractSingle: function(store, type, payload) {
    let included = [];
    if (payload && payload._embedded) {
      for (var relation in payload._embedded) {
        let relType = type.typeForRelationship(relation);
        let typeName = relType.modelName,
            embeddedPayload = payload._embedded[relation];

        if (embeddedPayload) {
          if (Ember.isArray(embeddedPayload)) {
            //store.pushMany(typeName, embeddedPayload);
            embeddedPayload.forEach(function(record) {
              included.pushObject(this.normalize(relType,record).data);
            }.bind(this));
          } else {
            //store.push(typeName, embeddedPayload);
            included.pushObject(this.normalize(relType, embeddedPayload).data);
          }
        }
      }

      delete payload._embedded;
    }

    return this.normalize(type, payload);
  },
  normalizeArrayResponse: function(store, type, payload) {
    let response = { data: [], included: [] };

    payload.forEach(function(json){
    let normalized = this.normalizeSingleResponse(store, type, json);
    response.data.pushObject(normalized.data);

    if(normalized.included){
      normalized.included.forEach(function(included){
        if(!response.included.contains(included.id)){
          response.included.addObject(included);
        }
      });
    }
    }.bind(this));

    return response;
   }
});
