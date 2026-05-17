use burn_import::onnx::ModelGen;

fn main() {
    // Generate the model code from the ONNX file.
    ModelGen::new()
        // .input("models/silero_vad_6.2.onnx")
        .input("models/silero_vad_op18_ifless.onnx")
        .out_dir("models/")
        .run_from_script();
}
