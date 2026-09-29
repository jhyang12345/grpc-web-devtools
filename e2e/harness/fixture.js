// One KitchenSink value, written as canonical proto3 JSON, used by every stack.
// Every field is set to a non-default value so a dropped field is always visible.
export const NOTE_TYPE_URL = "type.googleapis.com/inspector.e2e.Note";

export const SINK_JSON = Object.freeze({
  fDouble: 1.5,
  fFloat: 0.25,
  fInt32: -7,
  fInt64: "1234567890123",
  fUint32: 7,
  fUint64: "42",
  fSint32: -3,
  fSint64: "-5",
  fFixed32: 11,
  fFixed64: "13",
  fSfixed32: -17,
  fSfixed64: "-19",
  fBool: true,
  fString: "héllo ✓",
  fBytes: "AAEC+v8=",
  color: "COLOR_GREEN",
  nested: { label: "n", weight: 2 },
  tags: ["a", "b"],
  numbers: [1, 2, 3],
  items: [{ label: "i1", weight: 1 }, { label: "i2", weight: 2 }],
  labels: { env: "test" },
  nestedById: { 7: { label: "seven", weight: 7 } },
  choiceText: "picked",
  maybe: "present",
  createdAt: "2026-01-02T03:04:05.006Z",
  wrappedName: "wrapped",
  wrappedCount: "77",
  attachment: { "@type": NOTE_TYPE_URL, text: "packed" },
  metadata: { k: "v", n: 1, list: [true, null] },
  ttl: "90.500s",
});

export const requestJson = (overrides = {}) => ({
  sink: JSON.parse(JSON.stringify(SINK_JSON)),
  scenario: "ok",
  count: 0,
  errorCode: 0,
  ...overrides,
});

// Builds the same value with google-protobuf generated setters (grpc-web stacks).
export function buildJspbRequest(pb, json) {
  const wkt = {
    any: require("google-protobuf/google/protobuf/any_pb.js"),
    duration: require("google-protobuf/google/protobuf/duration_pb.js"),
    struct: require("google-protobuf/google/protobuf/struct_pb.js"),
    timestamp: require("google-protobuf/google/protobuf/timestamp_pb.js"),
    wrappers: require("google-protobuf/google/protobuf/wrappers_pb.js"),
  };
  const nested = value => {
    const message = new pb.Nested();
    message.setLabel(value.label);
    message.setWeight(value.weight);
    return message;
  };
  const request = new pb.EchoRequest();
  request.setScenario(json.scenario || "");
  request.setCount(json.count || 0);
  request.setErrorCode(json.errorCode || 0);
  const s = json.sink;
  if (s) {
    const sink = new pb.KitchenSink();
    sink.setFDouble(s.fDouble);
    sink.setFFloat(s.fFloat);
    sink.setFInt32(s.fInt32);
    sink.setFInt64(Number(s.fInt64));
    sink.setFUint32(s.fUint32);
    sink.setFUint64(Number(s.fUint64));
    sink.setFSint32(s.fSint32);
    sink.setFSint64(Number(s.fSint64));
    sink.setFFixed32(s.fFixed32);
    sink.setFFixed64(Number(s.fFixed64));
    sink.setFSfixed32(s.fSfixed32);
    sink.setFSfixed64(Number(s.fSfixed64));
    sink.setFBool(s.fBool);
    sink.setFString(s.fString);
    sink.setFBytes(s.fBytes);
    sink.setColor(pb.Color[s.color]);
    sink.setNested(nested(s.nested));
    sink.setTagsList(s.tags);
    sink.setNumbersList(s.numbers);
    sink.setItemsList(s.items.map(nested));
    Object.entries(s.labels).forEach(([key, value]) => sink.getLabelsMap().set(key, value));
    Object.entries(s.nestedById).forEach(([key, value]) => sink.getNestedByIdMap().set(Number(key), nested(value)));
    sink.setChoiceText(s.choiceText);
    sink.setMaybe(s.maybe);
    const createdAt = new wkt.timestamp.Timestamp();
    createdAt.fromDate(new Date(s.createdAt));
    sink.setCreatedAt(createdAt);
    const wrappedName = new wkt.wrappers.StringValue();
    wrappedName.setValue(s.wrappedName);
    sink.setWrappedName(wrappedName);
    const wrappedCount = new wkt.wrappers.Int64Value();
    wrappedCount.setValue(Number(s.wrappedCount));
    sink.setWrappedCount(wrappedCount);
    const note = new pb.Note();
    note.setText(s.attachment.text);
    const attachment = new wkt.any.Any();
    attachment.pack(note.serializeBinary(), "inspector.e2e.Note");
    sink.setAttachment(attachment);
    sink.setMetadata(wkt.struct.Struct.fromJavaScript(s.metadata));
    const ttl = new wkt.duration.Duration();
    ttl.setSeconds(90);
    ttl.setNanos(500000000);
    sink.setTtl(ttl);
    request.setSink(sink);
  }
  return request;
}
